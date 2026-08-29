import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  ConnectionManager,
  parseStoredConnectionTarget,
} from "../src/main/connection-manager.js";
import {
  probeHarborGateway,
  startLocalEngineGateway,
  type LocalEngineTarget,
  type LocalGatewayRuntime,
} from "../src/main/managed-gateway.js";

function fakeRuntime(
  overrides: Partial<LocalGatewayRuntime> = {},
): LocalGatewayRuntime & { closed: boolean } {
  const runtime = {
    url: "http://127.0.0.1:49000",
    sessionToken: "local-session-token",
    engineHostId: "dev-remote-engine",
    engineOnline: true,
    closed: false,
    close: async () => {
      runtime.closed = true;
    },
    ...overrides,
  };
  return runtime;
}

function manager(
  options: {
    gateway?: (endpoint: string) => Promise<boolean>;
    start?: (target: LocalEngineTarget) => Promise<LocalGatewayRuntime>;
    initialTarget?: ConstructorParameters<
      typeof ConnectionManager
    >[0]["initialTarget"];
  } = {},
) {
  const starts: LocalEngineTarget[] = [];
  const runtimes: LocalGatewayRuntime[] = [];
  const connection = new ConnectionManager({
    gatewayVersion: "test-desktop",
    initialTarget: options.initialTarget,
    probeGateway: options.gateway ?? (async () => false),
    startLocalGateway: async ({ engine }) => {
      starts.push(engine);
      const runtime =
        (await options.start?.(engine)) ??
        fakeRuntime({
          sessionToken: `session-${starts.length}`,
        });
      runtimes.push(runtime);
      return runtime;
    },
  });
  return { connection, starts, runtimes };
}

test("recognizes Harbor Desk Gateway responses without probing Docker paths", async () => {
  const requests: string[] = [];
  const result = await probeHarborGateway(
    "http://gateway.example.test:4311",
    100,
    async (input) => {
      requests.push(String(input));
      if (String(input).endsWith("/health/live"))
        return new Response(
          JSON.stringify({
            data: {
              status: "ok",
              version: "test-gateway",
              dependencies: { engine: "ok" },
            },
          }),
          { status: 200 },
        );
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
  );

  assert.equal(result, true);
  assert.deepEqual(requests, [
    "http://gateway.example.test:4311/health/live",
    "http://gateway.example.test:4311/api/v1/auth/providers",
  ]);
  assert.equal(
    requests.some((request) => request.endsWith("/version")),
    false,
  );
});

test("uses a detected Server Gateway directly and discards Engine TLS fields", async () => {
  const { connection, starts } = manager({ gateway: async () => true });
  const status = await connection.configure({
    endpoint: "http://gateway.example.test:4311",
    displayName: "Server preview",
    ca: "CA-MUST-NOT-PERSIST",
    cert: "CERT-MUST-NOT-PERSIST",
    key: "KEY-MUST-NOT-PERSIST",
  });

  assert.equal(status.mode, "gateway");
  assert.equal(status.gatewayUrl, "http://gateway.example.test:4311");
  assert.equal(status.localGateway, false);
  assert.equal(starts.length, 0);
  assert.deepEqual(connection.getPersistedTarget(), {
    endpoint: "http://gateway.example.test:4311",
    displayName: "Server preview",
    detectedMode: "gateway",
  });
  assert.equal(connection.getSessionToken(), undefined);
  assert.doesNotMatch(JSON.stringify(status), /MUST-NOT-PERSIST/);
});

test("wraps a raw Docker Engine and exposes only the local Gateway", async () => {
  const { connection, starts } = manager();
  const status = await connection.configure({
    endpoint: "https://engine.example.test:2376",
    displayName: "Remote Engine",
    ca: "CA-PEM",
    cert: "CERT-PEM",
    key: "KEY-PEM",
  });

  assert.equal(status.mode, "engine");
  assert.equal(status.localGateway, true);
  assert.equal(status.gatewayUrl, "http://127.0.0.1:49000");
  assert.equal(status.engineHostId, "dev-remote-engine");
  assert.equal(status.engineOnline, true);
  assert.deepEqual(starts, [
    {
      endpoint: "https://engine.example.test:2376",
      displayName: "Remote Engine",
      ca: "CA-PEM",
      cert: "CERT-PEM",
      key: "KEY-PEM",
    },
  ]);
  assert.deepEqual(connection.getPersistedTarget(), {
    endpoint: "https://engine.example.test:2376",
    displayName: "Remote Engine",
    ca: "CA-PEM",
    cert: "CERT-PEM",
    key: "KEY-PEM",
    detectedMode: "engine",
  });
  assert.equal(connection.getSessionToken(), "session-1");
  assert.deepEqual(await connection.clear(), {
    mode: "unconfigured",
    message: "No Gateway or Docker Engine connection is configured.",
    localGateway: false,
  });
});

test("starts the Local Gateway wrapper on a dynamic loopback port and probes the Engine internally", async (t) => {
  const paths: string[] = [];
  const engine = createServer((request, response) => {
    paths.push(request.url ?? "");
    response.setHeader("content-type", "application/json");
    if (request.url === "/version") {
      response.end(
        JSON.stringify({
          Version: "27.0.0",
          ApiVersion: "1.47",
          MinAPIVersion: "1.24",
        }),
      );
      return;
    }
    if (request.url === "/info") {
      response.end(
        JSON.stringify({
          ID: "fake-engine",
          ServerVersion: "27.0.0",
          ApiVersion: "1.47",
          MinAPIVersion: "1.24",
          OperatingSystem: "test",
          Architecture: "amd64",
          Containers: 0,
          ContainersRunning: 0,
          ContainersStopped: 0,
          Images: 0,
        }),
      );
      return;
    }
    if (request.url === "/events") {
      response.writeHead(200);
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise<void>((resolve, reject) => {
    engine.once("error", reject);
    engine.listen(0, "127.0.0.1", resolve);
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        engine.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = engine.address();
  assert.ok(address && typeof address !== "string");

  const runtime = await startLocalEngineGateway({
    engine: {
      endpoint: `http://127.0.0.1:${address.port}`,
      displayName: "Fake Engine",
    },
    gatewayVersion: "test-wrapper",
    env: {},
  });
  t.after(() => runtime.close());

  assert.match(runtime.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(runtime.engineHostId, "dev-remote-engine");
  assert.equal(runtime.engineOnline, true);
  const hostsResponse = await fetch(`${runtime.url}/api/v1/hosts`, {
    headers: {
      origin: "null",
      "x-harbor-desktop-token": runtime.sessionToken,
    },
  });
  assert.equal(hostsResponse.status, 200);
  const hosts = (await hostsResponse.json()) as {
    data?: Array<{ id?: string; displayName?: string; status?: string }>;
  };
  assert.equal(hosts.data?.length, 1);
  assert.equal(hosts.data?.[0]?.id, "dev-remote-engine");
  assert.equal(hosts.data?.[0]?.displayName, "Fake Engine");
  assert.equal(hosts.data?.[0]?.status, "online");
  assert.equal(paths.includes("/version"), true);
  assert.equal(paths.includes("/info"), true);
  assert.equal(
    paths.some((path) => path.endsWith("/events")),
    true,
  );
});

test("classifies npipe and unix targets as Engine connections without Gateway probing", async () => {
  const probes: string[] = [];
  const { connection, starts } = manager({
    gateway: async (endpoint) => {
      probes.push(endpoint);
      return true;
    },
  });

  assert.equal(
    (await connection.configure({ endpoint: "npipe://./pipe/docker_engine" }))
      .mode,
    "engine",
  );
  await connection.clear();
  assert.equal(
    (await connection.configure({ endpoint: "unix:///var/run/docker.sock" }))
      .mode,
    "engine",
  );
  assert.deepEqual(probes, []);
  assert.deepEqual(
    starts.map((target) => target.endpoint),
    ["npipe://./pipe/docker_engine", "unix:///var/run/docker.sock"],
  );
});

test("rejects insecure remote raw Engines and incomplete remote HTTPS TLS", async () => {
  const insecure = manager();
  const insecureStatus = await insecure.connection.configure({
    endpoint: "http://engine.example.test:2375",
  });
  assert.equal(insecureStatus.mode, "unavailable");
  assert.match(insecureStatus.message, /must use HTTPS/i);
  assert.equal(insecure.starts.length, 0);

  const incomplete = manager();
  const incompleteStatus = await incomplete.connection.configure({
    endpoint: "https://engine.example.test:2376",
    ca: "CA-PEM",
    cert: "CERT-PEM",
  });
  assert.equal(incompleteStatus.mode, "unavailable");
  assert.match(incompleteStatus.message, /require a CA certificate/i);
  assert.equal(incomplete.starts.length, 0);
});

test("keeps an offline saved Gateway unavailable instead of creating a local wrapper", async () => {
  let startCalled = false;
  const { connection } = manager({
    initialTarget: {
      endpoint: "http://gateway.example.test:4311",
      displayName: "Saved Gateway",
      detectedMode: "gateway",
    },
    gateway: async () => false,
    start: async () => {
      startCalled = true;
      throw new Error("must not start");
    },
  });

  const status = await connection.initialize();
  assert.equal(status.mode, "unavailable");
  assert.equal(status.localGateway, false);
  assert.equal(startCalled, false);
});

test("closes a Local Gateway when a saved Engine is offline on restart", async () => {
  const runtime = fakeRuntime({ engineOnline: false });
  const { connection, runtimes } = manager({
    initialTarget: {
      endpoint: "https://engine.example.test:2376",
      displayName: "Saved Engine",
      ca: "CA",
      cert: "CERT",
      key: "KEY",
      detectedMode: "engine",
    },
    start: async () => runtime,
  });

  const status = await connection.initialize();
  assert.equal(status.mode, "unavailable");
  assert.equal(status.localGateway, false);
  assert.equal(runtime.closed, true);
  assert.equal(runtimes.length, 1);
  assert.equal(connection.getSessionToken(), undefined);
  assert.deepEqual(connection.getPersistedTarget(), {
    endpoint: "https://engine.example.test:2376",
    displayName: "Saved Engine",
    ca: "CA",
    cert: "CERT",
    key: "KEY",
    detectedMode: "engine",
  });
});

test("closes the previous Local Gateway when switching to a Server Gateway", async () => {
  const runtime = fakeRuntime();
  const { connection } = manager({
    gateway: async (endpoint) => endpoint.includes("gateway"),
    start: async () => runtime,
  });

  assert.equal(
    (
      await connection.configure({
        endpoint: "https://engine.example.test:2376",
        ca: "CA",
        cert: "CERT",
        key: "KEY",
      })
    ).mode,
    "engine",
  );
  assert.equal(runtime.closed, false);

  assert.equal(
    (
      await connection.configure({
        endpoint: "http://gateway.example.test:4311",
      })
    ).mode,
    "gateway",
  );
  assert.equal(runtime.closed, true);
  assert.equal(connection.getSessionToken(), undefined);
});

test("does not expose TLS material in stored Gateway targets or status", () => {
  const gateway = parseStoredConnectionTarget(
    JSON.stringify({
      endpoint: "https://gateway.example.test:4311",
      displayName: "Gateway",
      detectedMode: "gateway",
      ca: "CA-SECRET",
      cert: "CERT-SECRET",
      key: "KEY-SECRET",
    }),
  );
  assert.deepEqual(gateway, {
    endpoint: "https://gateway.example.test:4311",
    displayName: "Gateway",
    detectedMode: "gateway",
  });
  assert.doesNotMatch(JSON.stringify(gateway), /SECRET/);
});

test("rejects malformed targets before changing the active connection", async () => {
  const { connection } = manager({ gateway: async () => true });
  await connection.configure({ endpoint: "http://gateway.example.test:4311" });

  await assert.rejects(
    connection.configure({
      endpoint: "http://user:password@gateway.example.test:4311",
    }),
    /without credentials/i,
  );
  assert.equal(connection.getStatus().mode, "gateway");
  assert.equal(connection.getGatewayUrl(), "http://gateway.example.test:4311");
});
