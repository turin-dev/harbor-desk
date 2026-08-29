import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import type { GatewayConfig } from "@harbor/config";
import { MemoryEncryptedSecretStore } from "./services/secret-store.js";

const testConfig: GatewayConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  gatewayVersion: "test",
  allowedOrigins: ["http://localhost:5173"],
  authMode: "dev",
  oidcProviders: [],
  engineEndpointAllowlist: [],
  secretMasterKey: "test-master-key",
};

test("exposes health, current user, and typed empty host responses", async (t) => {
  const harbor = await buildApp(testConfig);
  t.after(async () => harbor.app.close());

  const health = await harbor.app.inject({
    method: "GET",
    url: "/health/live",
  });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().data.status, "ok");

  const user = await harbor.app.inject({ method: "GET", url: "/api/v1/me" });
  assert.equal(user.statusCode, 200);
  assert.equal(user.json().data.role, "admin");

  const hosts = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hosts",
  });
  assert.equal(hosts.statusCode, 200);
  assert.deepEqual(hosts.json().data, []);
});

test("protects a Local Gateway wrapper with its per-launch token", async (t) => {
  const desktopSessionToken = "desktop-session-token-1234567890";
  const harbor = await buildApp({
    ...testConfig,
    allowedOrigins: ["null"],
    desktopSessionToken,
  });
  t.after(async () => harbor.app.close());

  const missing = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/me",
    headers: { origin: "null" },
  });
  assert.equal(missing.statusCode, 401);

  const wrong = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/me",
    headers: {
      origin: "null",
      "x-harbor-desktop-token": "wrong-token",
    },
  });
  assert.equal(wrong.statusCode, 401);

  const preflight = await harbor.app.inject({
    method: "OPTIONS",
    url: "/api/v1/me",
    headers: {
      origin: "null",
      "access-control-request-method": "GET",
      "access-control-request-headers": "x-harbor-desktop-token",
    },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], "null");
  assert.match(
    String(preflight.headers["access-control-allow-headers"]),
    /x-harbor-desktop-token/i,
  );

  const allowed = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/me",
    headers: {
      origin: "null",
      "x-harbor-desktop-token": desktopSessionToken,
    },
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers["access-control-allow-origin"], "null");
  assert.equal(allowed.json().data.role, "admin");
});

test("rejects malformed host registration input with a validation error", async (t) => {
  const harbor = await buildApp(testConfig);
  t.after(async () => harbor.app.close());

  const response = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts",
    payload: { displayName: "", endpoint: "not-an-endpoint" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "validation_error");
});

test("requires mutual TLS for production host registrations", async (t) => {
  const harbor = await buildApp(
    {
      ...testConfig,
      nodeEnv: "production",
    },
    {
      secrets: new MemoryEncryptedSecretStore(testConfig.secretMasterKey),
    },
  );
  t.after(async () => harbor.app.close());

  const response = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts",
    payload: {
      displayName: "Plaintext engine",
      endpoint: "http://engine.internal:2375",
    },
  });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, "mtls_required");
});

test("fails closed when production has no injected secret store", async () => {
  await assert.rejects(
    () => buildApp({ ...testConfig, nodeEnv: "production" }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "secret_store_not_configured",
  );
});
