import assert from "node:assert/strict";
import test from "node:test";
import {
  isHttpEndpoint,
  probeHarborGateway,
} from "../src/main/managed-gateway.js";

function healthBody(overrides: Record<string, unknown> = {}): {
  data: Record<string, unknown>;
} {
  return {
    data: {
      status: "ok",
      version: "0.1.0",
      dependencies: { dockerEngine: "not-configured" },
      ...overrides,
    },
  };
}

test("isHttpEndpoint accepts only plain http and https URLs", () => {
  assert.equal(isHttpEndpoint("http://127.0.0.1:4310"), true);
  assert.equal(isHttpEndpoint("https://eng.example.com:2376"), true);
  assert.equal(isHttpEndpoint("npipe:////./pipe/docker_engine"), false);
  assert.equal(isHttpEndpoint("unix:///var/run/docker.sock"), false);
  assert.equal(isHttpEndpoint("not a url"), false);
  assert.equal(isHttpEndpoint(""), false);
});

test("probeHarborGateway returns true for a healthy gateway", async () => {
  const ok = (body: unknown) =>
    Response.json(body, { status: 200, statusText: "OK" });
  const routes: Record<string, (url: string) => Response> = {};
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const handler = routes[url.pathname];
    if (!handler) throw new Error("unexpected fetch " + url.pathname);
    return handler(url);
  }) as typeof fetch;
  routes["/health/live"] = () => ok(healthBody());
  routes["/api/v1/auth/providers"] = () =>
    ok({ data: [{ id: "keycloak", name: "Keycloak" }] });
  assert.equal(
    await probeHarborGateway("http://127.0.0.1:4310", 1000, fetchImpl),
    true,
  );
});

test("probeHarborGateway accepts degraded status but rejects bad health bodies", async () => {
  const mk = (body: unknown) =>
    Response.json(body, { status: 200, statusText: "OK" });
  const run = async (health: unknown, providers: unknown): Promise<boolean> => {
    const routes: Record<string, (url: string) => Response> = {};
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const handler = routes[url.pathname];
      if (!handler) throw new Error("unexpected fetch " + url.pathname);
      return handler(url);
    }) as typeof fetch;
    routes["/health/live"] = () => mk(health);
    routes["/api/v1/auth/providers"] = () => mk(providers);
    return probeHarborGateway("http://127.0.0.1:4310", 1000, fetchImpl);
  };
  assert.equal(
    await run(healthBody({ status: "degraded" }), { data: [] }),
    true,
  );
  assert.equal(await run(healthBody({ status: "down" }), { data: [] }), false);
  assert.equal(
    await run({ data: { status: "ok", dependencies: {} } }, { data: [] }),
    false,
  );
  assert.equal(await run(healthBody(), { data: "none" }), false);
  assert.equal(await run(healthBody(), undefined), false);
});

test("probeHarborGateway rejects non-gateway endpoints and failures", async () => {
  const ok = (body: unknown) =>
    Response.json(body, { status: 200, statusText: "OK" });
  let fetched = 0;
  const fetchImpl = (async () => {
    fetched += 1;
    return ok(healthBody());
  }) as typeof fetch;
  const bad = [
    "http://127.0.0.1:4310/prefix",
    "http://127.0.0.1:4310/?x=1",
    "http://user:pass@127.0.0.1:4310",
    "npipe:////./pipe/docker_engine",
    "not a url",
  ];
  for (const endpoint of bad) {
    assert.equal(
      await probeHarborGateway(endpoint, 1000, fetchImpl),
      false,
      endpoint,
    );
  }
  assert.equal(fetched, 0);

  const notOk = (async () =>
    new Response(null, {
      status: 500,
      statusText: "Internal Error",
    })) as typeof fetch;
  assert.equal(
    await probeHarborGateway("http://127.0.0.1:4310", 1000, notOk),
    false,
  );

  const throwing = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  assert.equal(
    await probeHarborGateway("http://127.0.0.1:4310", 1000, throwing),
    false,
  );

  const notJson = (async () =>
    new Response("<html>", { status: 200, statusText: "OK" })) as typeof fetch;
  assert.equal(
    await probeHarborGateway("http://127.0.0.1:4310", 1000, notJson),
    false,
  );
});
