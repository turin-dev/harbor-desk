import assert from "node:assert/strict";
import test from "node:test";
import { asBoolean, loadGatewayConfig } from "./index.js";

test("allows local development renderer origins and the packaged origin by default", () => {
  assert.deepEqual(loadGatewayConfig({}).allowedOrigins, [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "null",
  ]);
});

test("does not allow the packaged origin by default in production", () => {
  assert.deepEqual(
    loadGatewayConfig({ NODE_ENV: "production" }).allowedOrigins,
    ["http://localhost:5173", "http://127.0.0.1:5173"],
  );
});

test("uses an explicit origin allowlist when configured", () => {
  assert.deepEqual(
    loadGatewayConfig({
      ALLOWED_ORIGINS: "https://desk.example.com, https://ops.example.com",
    }).allowedOrigins,
    ["https://desk.example.com", "https://ops.example.com"],
  );
});

test("applies loopback defaults and reads explicit host and port overrides", () => {
  const defaults = loadGatewayConfig({});
  assert.equal(defaults.host, "127.0.0.1");
  assert.equal(defaults.port, 4310);
  assert.equal(defaults.gatewayVersion, "0.1.0");
  assert.equal(defaults.authMode, "dev");
  const overridden = loadGatewayConfig({
    HOST: "0.0.0.0",
    PORT: "5100",
    GATEWAY_VERSION: "9.9.9",
  });
  assert.equal(overridden.host, "0.0.0.0");
  assert.equal(overridden.port, 5100);
  assert.equal(overridden.gatewayVersion, "9.9.9");
});

test("falls back to defaults for malformed port values", () => {
  assert.equal(loadGatewayConfig({ PORT: "not-a-number" }).port, 4310);
  assert.equal(loadGatewayConfig({ PORT: "" }).port, 4310);
});

test("forces OIDC in production and keeps AUTH_MODE dev in development", () => {
  assert.equal(loadGatewayConfig({ NODE_ENV: "production" }).authMode, "oidc");
  assert.equal(loadGatewayConfig({ NODE_ENV: "development" }).authMode, "dev");
  assert.equal(loadGatewayConfig({ AUTH_MODE: "oidc" }).authMode, "oidc");
  assert.equal(loadGatewayConfig({ AUTH_MODE: "nope" }).authMode, "dev");
  assert.equal(
    loadGatewayConfig({ NODE_ENV: "production", AUTH_MODE: "dev" }).authMode,
    "oidc",
  );
});

test("parses engine endpoint allowlist into normalized entries", () => {
  const config = loadGatewayConfig({
    ENGINE_ENDPOINT_ALLOWLIST:
      " npipe://docker_engine , https://HOST.example ,",
  });
  assert.deepEqual(config.engineEndpointAllowlist, [
    "npipe://docker_engine",
    "https://host.example",
  ]);
  assert.deepEqual(loadGatewayConfig({}).engineEndpointAllowlist, []);
});

test("maps DEV_ENGINE settings and trims display names", () => {
  const config = loadGatewayConfig({
    DEV_ENGINE_HOST: "npipe://docker_engine",
    DEV_ENGINE_DISPLAY_NAME: "  local engine  ",
    DEV_ENGINE_CA_FILE: "ca.pem",
    DEV_ENGINE_CERT_FILE: "cert.pem",
    DEV_ENGINE_KEY_FILE: "key.pem",
  });
  assert.equal(config.devEngineHost, "npipe://docker_engine");
  assert.equal(config.devEngineDisplayName, "local engine");
  assert.deepEqual(config.devEngineTls, {
    caFile: "ca.pem",
    certFile: "cert.pem",
    keyFile: "key.pem",
  });
  const empty = loadGatewayConfig({ DEV_ENGINE_DISPLAY_NAME: "   " });
  assert.equal(empty.devEngineHost, undefined);
  assert.equal(empty.devEngineDisplayName, undefined);
  assert.equal(empty.devEngineTls?.caFile, undefined);
});

test("parses OIDC provider JSON and drops invalid or incomplete entries", () => {
  const config = loadGatewayConfig({
    OIDC_PROVIDERS_JSON: JSON.stringify([
      { id: 1, displayName: "Bad", issuer: "i", audience: "a", clientId: "c" },
      null,
      {
        id: "ok",
        displayName: "Good",
        issuer: "iss",
        audience: "aud",
        clientId: "cid",
      },
      {
        id: "nosecopes",
        displayName: "No",
        issuer: "i",
        audience: "a",
        clientId: "c",
        scopes: "openid",
      },
    ]),
  });
  assert.equal(config.oidcProviders.length, 2);
  assert.equal(config.oidcProviders[0]!.id, "ok");
  assert.deepEqual(config.oidcProviders[0]!.scopes, [
    "openid",
    "profile",
    "email",
  ]);
  assert.deepEqual(config.oidcProviders[1]!.scopes, [
    "openid",
    "profile",
    "email",
  ]);
  assert.deepEqual(
    loadGatewayConfig({ OIDC_PROVIDERS_JSON: "not-json" }).oidcProviders,
    [],
  );
  assert.deepEqual(
    loadGatewayConfig({ OIDC_PROVIDERS_JSON: "{}" }).oidcProviders,
    [],
  );
});

test("asBoolean recognizes 1/true case-insensitively and falls back otherwise", () => {
  assert.equal(asBoolean(undefined, true), true);
  assert.equal(asBoolean(undefined, false), false);
  assert.equal(asBoolean("1", false), true);
  assert.equal(asBoolean("TRUE", false), true);
  assert.equal(asBoolean("true", false), true);
  assert.equal(asBoolean("0", true), false);
  assert.equal(asBoolean("nope", true), false);
});
