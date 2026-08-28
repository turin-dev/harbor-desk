import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import {
  managedGatewayTarget,
  startManagedGateway,
} from "../src/main/managed-gateway.js";

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!port) throw new Error("Could not allocate a loopback test port.");
  return port;
}

test("only auto-starts a plain HTTP gateway on 127.0.0.1", () => {
  assert.deepEqual(managedGatewayTarget("http://127.0.0.1:4310"), {
    host: "127.0.0.1",
    port: 4310,
    origin: "http://127.0.0.1:4310",
  });
  assert.equal(managedGatewayTarget("https://127.0.0.1:4310"), undefined);
  assert.equal(managedGatewayTarget("http://localhost:4310"), undefined);
  assert.equal(managedGatewayTarget("http://192.168.1.20:4310"), undefined);
  assert.equal(
    managedGatewayTarget("http://127.0.0.1:4310/base-path"),
    undefined,
  );
  assert.equal(
    managedGatewayTarget("http://user:secret@127.0.0.1:4310"),
    undefined,
  );
  assert.equal(
    managedGatewayTarget("http://127.0.0.1:4310/?token=secret"),
    undefined,
  );
});

test("starts a token-protected gateway and reuses an existing instance", async (t) => {
  const port = await unusedLoopbackPort();
  const gatewayUrl = `http://127.0.0.1:${port}`;
  const sessionToken = "managed-desktop-session-token-123456789";
  const runtime = await startManagedGateway({
    gatewayUrl,
    gatewayVersion: "test-desktop",
    sessionToken,
    probeTimeoutMs: 100,
    env: {},
  });
  t.after(() => runtime.close());

  assert.equal(runtime.status.state, "managed");
  assert.equal(runtime.sessionToken, sessionToken);

  const health = await fetch(`${gatewayUrl}/health/live`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).data.version, "test-desktop");

  const missingToken = await fetch(`${gatewayUrl}/api/v1/me`, {
    headers: { origin: "null" },
  });
  assert.equal(missingToken.status, 401);

  const currentUser = await fetch(`${gatewayUrl}/api/v1/me`, {
    headers: {
      origin: "null",
      "x-harbor-desktop-token": sessionToken,
    },
  });
  assert.equal(currentUser.status, 200);
  assert.equal(currentUser.headers.get("access-control-allow-origin"), "null");

  const existing = await startManagedGateway({
    gatewayUrl,
    gatewayVersion: "second-client",
    sessionToken: "different-token",
    probeTimeoutMs: 500,
    env: {},
  });
  assert.equal(existing.status.state, "external");
  assert.equal(existing.sessionToken, undefined);
  await existing.close();
});

test("does not start a gateway when automatic startup is disabled", async () => {
  const port = await unusedLoopbackPort();
  const runtime = await startManagedGateway({
    gatewayUrl: `http://127.0.0.1:${port}`,
    gatewayVersion: "disabled-test",
    disabled: true,
    env: {},
  });

  assert.equal(runtime.status.state, "disabled");
  assert.equal(runtime.sessionToken, undefined);
  await runtime.close();
  await assert.rejects(
    fetch(`http://127.0.0.1:${port}/health/live`, {
      signal: AbortSignal.timeout(250),
    }),
  );
});

test("leaves non-loopback gateway configurations external", async () => {
  const runtime = await startManagedGateway({
    gatewayUrl: "https://gateway.example.test",
    gatewayVersion: "external-test",
    env: {},
  });

  assert.equal(runtime.status.state, "external");
  assert.equal(runtime.status.url, "https://gateway.example.test");
  assert.equal(runtime.sessionToken, undefined);
  await runtime.close();
});

test("releases the loopback listener when the managed runtime closes", async () => {
  const port = await unusedLoopbackPort();
  const gatewayUrl = `http://127.0.0.1:${port}`;
  const runtime = await startManagedGateway({
    gatewayUrl,
    gatewayVersion: "shutdown-test",
    sessionToken: "shutdown-session-token-1234567890",
    probeTimeoutMs: 100,
    env: {},
  });

  assert.equal((await fetch(`${gatewayUrl}/health/live`)).status, 200);
  await runtime.close();
  await assert.rejects(
    fetch(`${gatewayUrl}/health/live`, {
      signal: AbortSignal.timeout(250),
    }),
  );
});
