import test from "node:test";
import assert from "node:assert/strict";

import type {
  CapabilityMatrix,
  ContainerSummary,
  EngineSummary,
  Host,
  NetworkSummary,
  VolumeSummary,
} from "@harbor/contracts";
import type { GatewayConfig } from "@harbor/config";
import {
  DockerEngineClient,
  EngineRequestError,
  type EngineProbe,
} from "@harbor/connectors";
import { HttpError } from "../errors.js";
import { EventHub } from "./events.js";
import { HostRegistry } from "./host-registry.js";
import type { SecretStore } from "./secret-store.js";

const baseConfig: GatewayConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 4310,
  gatewayVersion: "test",
  allowedOrigins: [],
  authMode: "dev",
  oidcProviders: [],
  engineEndpointAllowlist: [],
  secretMasterKey: "test-master-key",
};

function caps(overrides: Partial<CapabilityMatrix> = {}): CapabilityMatrix {
  return {
    containers: false,
    images: false,
    volumes: false,
    networks: false,
    logs: false,
    stats: false,
    exec: false,
    compose: false,
    buildkit: false,
    kubernetes: false,
    extensions: false,
    imageScan: false,
    volumeFileBrowser: false,
    ...overrides,
  };
}

function probeResult(): EngineProbe {
  return {
    summary: {
      version: "29.0.0",
      apiVersion: "1.51",
      minApiVersion: "1.24",
    },
    capabilities: caps({ containers: true, images: true }),
  };
}

interface FakeRecord {
  publicHost: Host;
  connection: { endpoint: string; secretReference?: string };
  client: DockerEngineClient;
  lastError?: string;
}

function makeRegistry(
  config: GatewayConfig = baseConfig,
  options: { events?: EventHub; secrets?: SecretStore } = {},
) {
  const events = options.events ?? new EventHub();
  return {
    registry: new HostRegistry({ config, events, secrets: options.secrets }),
    events,
  };
}

function inject(registry: HostRegistry, record: FakeRecord): FakeRecord {
  (registry as unknown as { records: Map<string, FakeRecord> }).records.set(
    record.publicHost.id,
    record,
  );
  return record;
}

function makeRecord(
  client: DockerEngineClient,
  status: Host["status"] = "online",
  id = "h1",
): FakeRecord {
  return {
    publicHost: {
      id,
      displayName: "Host " + id,
      status,
      capabilities: caps(),
      connectionMode: "development-http",
    },
    connection: { endpoint: "http://127.0.0.1:2375" },
    client,
  };
}

function clientStub(methods: Record<string, unknown> = {}) {
  return {
    probe: async () => probeResult(),
    createEventStream: () => new Promise<never>(() => {}),
    ...methods,
  } as unknown as DockerEngineClient;
}

function assertHttpError(
  operation: Promise<unknown>,
  statusCode: number,
  code: string,
) {
  return assert.rejects(
    () => operation,
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === statusCode &&
      error.code === code,
  );
}

function fakeSecrets() {
  const puts: string[] = [];
  const deleted: string[] = [];
  let next = 1;
  const store: SecretStore = {
    put: async (value: string) => {
      puts.push(value);
      return "ref-" + next++;
    },
    get: async () => undefined,
    delete: async (reference: string) => {
      deleted.push(reference);
    },
  };
  return { store, puts, deleted };
}

function stubEngineClient(t: { after: (fn: () => void) => void }) {
  const realProbe = DockerEngineClient.prototype.probe;
  const realStream = DockerEngineClient.prototype.createEventStream;
  DockerEngineClient.prototype.probe = async () => probeResult();
  DockerEngineClient.prototype.createEventStream = () =>
    new Promise<never>(() => {});
  t.after(() => {
    DockerEngineClient.prototype.probe = realProbe;
    DockerEngineClient.prototype.createEventStream = realStream;
  });
}

test("production without an injected secret store throws 503", () => {
  assert.throws(
    () => makeRegistry({ ...baseConfig, nodeEnv: "production" }).registry,
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      error.code === "secret_store_not_configured",
  );
});

test("devEngineHost is auto-registered in development mode", () => {
  const { registry } = makeRegistry({
    ...baseConfig,
    devEngineHost: "npipe:////./pipe/docker_engine",
    devEngineDisplayName: "Dev Engine",
  });
  const host = registry.list()[0]!;
  assert.equal(host.id, "dev-remote-engine");
  assert.equal(host.displayName, "Dev Engine");
  assert.equal(host.status, "unknown");
  assert.equal(host.connectionMode, "development-socket");
  assert.deepEqual(host.capabilities, caps());
});

test("devEngineHost in production is rejected without full mTLS material", () => {
  assert.throws(
    () =>
      makeRegistry(
        {
          ...baseConfig,
          nodeEnv: "production",
          devEngineHost: "https://eng.example.com:2376",
        },
        { secrets: fakeSecrets().store },
      ).registry,
    (error: unknown) =>
      error instanceof HttpError && error.code === "mtls_required",
  );
});

test("production allowlist enforces exact and wildcard hostnames", () => {
  const tls = { ca: "ca", cert: "cert", key: "key" };
  const noPolicy = makeRegistry(
    { ...baseConfig, nodeEnv: "production" },
    { secrets: fakeSecrets().store },
  );
  const exact = makeRegistry(
    {
      ...baseConfig,
      nodeEnv: "production",
      engineEndpointAllowlist: ["eng.example.com"],
    },
    { secrets: fakeSecrets().store },
  );
  const wildcard = makeRegistry(
    {
      ...baseConfig,
      nodeEnv: "production",
      engineEndpointAllowlist: ["*.lab.internal"],
    },
    { secrets: fakeSecrets().store },
  );
  assert.throws(
    () =>
      (
        noPolicy.registry as unknown as {
          validateEndpoint: (e: string, m?: object) => void;
        }
      ).validateEndpoint("https://eng.example.com:2376", tls),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      error.code === "endpoint_policy_not_configured",
  );
  assert.throws(
    () =>
      (
        exact.registry as unknown as {
          validateEndpoint: (e: string, m?: object) => void;
        }
      ).validateEndpoint("https://other.example.com", tls),
    (error: unknown) =>
      error instanceof HttpError && error.code === "endpoint_not_allowed",
  );
  (
    exact.registry as unknown as {
      validateEndpoint: (e: string, m?: object) => void;
    }
  ).validateEndpoint("https://ENG.example.com", tls);
  (
    wildcard.registry as unknown as {
      validateEndpoint: (e: string, m?: object) => void;
    }
  ).validateEndpoint("https://node1.lab.internal:2376", tls);
});

test("validateEndpoint rejects malformed, credentialed, and plain-http production endpoints", () => {
  const { registry } = makeRegistry();
  const validate = (
    endpoint: string,
    tlsMaterial?: { ca?: string; cert?: string; key?: string },
  ) =>
    (
      registry as unknown as {
        validateEndpoint: (e: string, m?: object) => void;
      }
    ).validateEndpoint(endpoint, tlsMaterial);
  assert.throws(
    () => validate("not-a-url"),
    (error: unknown) =>
      error instanceof HttpError && error.code === "invalid_endpoint",
  );
  assert.throws(
    () => validate("ftp://127.0.0.1:21"),
    (error: unknown) =>
      error instanceof HttpError && error.code === "invalid_endpoint",
  );
  assert.throws(
    () => validate("http://user:pass@127.0.0.1:2375"),
    (error: unknown) =>
      error instanceof HttpError && error.code === "invalid_endpoint",
  );
  const prodRegistry = makeRegistry(
    {
      ...baseConfig,
      nodeEnv: "production",
      engineEndpointAllowlist: ["eng.example.com"],
    },
    { secrets: fakeSecrets().store },
  ).registry;
  assert.throws(
    () =>
      (
        prodRegistry as unknown as {
          validateEndpoint: (e: string, m?: object) => void;
        }
      ).validateEndpoint("http://eng.example.com:2375", {
        ca: "ca",
        cert: "cert",
        key: "key",
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 422 &&
      error.code === "mtls_required",
  );
  validate("http://127.0.0.1:2375");
  validate("unix:///var/run/docker.sock");
});

test("get throws 404 and list returns defensive copies", () => {
  const { registry } = makeRegistry();
  assert.throws(
    () => registry.get("missing"),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 404 &&
      error.code === "host_not_found",
  );
  assert.deepEqual(registry.list(), []);
  const record = inject(registry, makeRecord(clientStub()));
  const first = registry.list()[0]!;
  assert.equal(first.id, "h1");
  first.displayName = "mutated";
  assert.notEqual(record.publicHost.displayName, "mutated");
});

test("add() maps protocols to connection modes and stores TLS secrets", async (t) => {
  stubEngineClient(t);
  const { store, puts, deleted } = fakeSecrets();
  const { registry } = makeRegistry(baseConfig, { secrets: store });

  const plain = await registry.add({
    displayName: "Plain",
    endpoint: "http://127.0.0.1:2375",
  });
  assert.equal(plain.connectionMode, "development-http");
  assert.equal(plain.status, "online");
  assert.equal(plain.engineVersion, "29.0.0");
  assert.equal(plain.apiVersion, "1.51");
  assert.equal(plain.minApiVersion, "1.24");
  assert.equal(plain.capabilities.containers, true);
  assert.equal(plain.capabilities.buildkit, false);
  assert.ok(plain.lastSeenAt);

  const socket = await registry.add({
    displayName: "Socket",
    endpoint: "npipe:////./pipe/docker_engine",
  });
  assert.equal(socket.connectionMode, "development-socket");

  const mtl = await registry.add({
    displayName: "MTLS",
    endpoint: "https://eng.example.com:2376",
    ca: "ca-pem",
    cert: "cert-pem",
    key: "key-pem",
  });
  assert.equal(mtl.connectionMode, "mtls");
  assert.equal(puts.length, 1);
  assert.deepEqual(JSON.parse(puts[0]!), {
    ca: "ca-pem",
    cert: "cert-pem",
    key: "key-pem",
  });

  assert.equal(registry.list().length, 3);
  await registry.remove(plain.id);
  await registry.remove(socket.id);
  assert.deepEqual(deleted, []);
  await registry.remove(mtl.id);
  assert.deepEqual(deleted, ["ref-1"]);
  assert.deepEqual(registry.list(), []);
});

test("remove() aborts the Engine event stream for that host", async () => {
  const { registry } = makeRegistry();
  let captured: AbortSignal | undefined;
  const client = clientStub({
    createEventStream: (signal?: AbortSignal) => {
      captured = signal;
      return new Promise<never>(() => {});
    },
  });
  const record = inject(registry, makeRecord(client));
  void (
    registry as unknown as {
      watchEvents: (hostId: string, rec: FakeRecord) => Promise<void>;
    }
  ).watchEvents("h1", record);
  assert.ok(captured, "watchEvents wires an AbortSignal into the event stream");
  assert.equal(captured.aborted, false);
  await registry.remove("h1");
  assert.equal(captured.aborted, true);
});

test("close() aborts every active Engine event stream", async () => {
  const { registry } = makeRegistry();
  const signals: AbortSignal[] = [];
  const make = () =>
    clientStub({
      createEventStream: (signal?: AbortSignal) => {
        signals.push(signal as AbortSignal);
        return new Promise<never>(() => {});
      },
    });
  const a = inject(registry, makeRecord(make(), "online", "ha"));
  const b = inject(registry, makeRecord(make(), "online", "hb"));
  void (
    registry as unknown as {
      watchEvents: (hostId: string, rec: FakeRecord) => Promise<void>;
    }
  ).watchEvents("ha", a);
  void (
    registry as unknown as {
      watchEvents: (hostId: string, rec: FakeRecord) => Promise<void>;
    }
  ).watchEvents("hb", b);
  assert.equal(signals.length, 2);
  await registry.close();
  assert.equal(signals[0]!.aborted, true);
  assert.equal(signals[1]!.aborted, true);
});

test("add() fails fast with 422 without touching the secret store", async () => {
  const { store, puts } = fakeSecrets();
  const { registry } = makeRegistry(baseConfig, { secrets: store });
  await assertHttpError(
    registry.add({ displayName: "Bad", endpoint: "nope" }),
    422,
    "invalid_endpoint",
  );
  assert.deepEqual(puts, []);
  assert.deepEqual(registry.list(), []);
});

test("test() refreshes: probe success goes online, failure goes offline", async () => {
  const { registry } = makeRegistry();
  const ok = makeRecord(clientStub());
  inject(registry, ok);
  const online = await registry.test("h1");
  assert.equal(online.status, "online");
  assert.equal(online.engineVersion, "29.0.0");
  assert.ok(online.lastSeenAt);

  const bad = makeRecord(
    clientStub({
      probe: async () => {
        throw new Error("ECONNREFUSED 10.0.0.5:2375");
      },
    }),
    "unknown",
    "h2",
  );
  inject(registry, bad);
  const offline = await registry.test("h2");
  assert.equal(offline.status, "offline");
  assert.equal(bad.lastError, "ECONNREFUSED 10.0.0.5:2375");
});

test("dashboard() aggregates counts and falls back to recorded versions", async () => {
  const { registry } = makeRegistry();
  const containers: ContainerSummary[] = [
    {
      id: "c1",
      name: "a",
      image: "nginx",
      state: "running",
      status: "Up",
      ports: [],
      labels: {},
      hostId: "h1",
    },
    {
      id: "c2",
      name: "b",
      image: "redis",
      state: "exited",
      status: "Exited",
      ports: [],
      labels: {},
      hostId: "h1",
    },
    {
      id: "c3",
      name: "c",
      image: "app",
      state: "running",
      status: "Up",
      ports: [],
      labels: {},
      hostId: "h1",
    },
  ];
  const client = clientStub({
    getInfo: async (): Promise<EngineSummary> => ({
      version: "29.0.0",
      apiVersion: "1.51",
      minApiVersion: "1.24",
      images: 7,
    }),
    listContainers: async () => containers,
    listVolumes: async (): Promise<VolumeSummary[]> => [
      { name: "v1", driver: "local", hostId: "h1" },
    ],
    listNetworks: async (): Promise<NetworkSummary[]> => [
      {
        id: "n1",
        name: "bridge",
        driver: "bridge",
        scope: "local",
        internal: false,
        hostId: "h1",
      },
      {
        id: "n2",
        name: "host",
        driver: "host",
        scope: "local",
        internal: false,
        hostId: "h1",
      },
    ],
  });
  const record = makeRecord(client);
  inject(registry, record);
  const dashboard = await registry.dashboard("h1");
  assert.deepEqual(dashboard.counts, {
    containers: 3,
    running: 2,
    images: 7,
    volumes: 1,
    networks: 2,
  });
  assert.equal(dashboard.host.status, "online");
  assert.equal(dashboard.engine.version, "29.0.0");

  record.publicHost = {
    ...record.publicHost,
    status: "unknown",
    engineVersion: "28.1.0",
    apiVersion: "1.50",
    minApiVersion: "1.24",
  };
  (client as { getInfo: () => Promise<EngineSummary> }).getInfo = async () => ({
    images: 2,
  });
  const second = await registry.dashboard("h1");
  assert.equal(second.engine.version, "28.1.0");
  assert.equal(second.engine.apiVersion, "1.50");
  assert.equal(second.counts.images, 2);
});

test("upstreamError maps engine failures to stable problem codes", () => {
  const { registry } = makeRegistry();
  const map = (
    registry: HostRegistry,
    error: unknown,
  ): { status: number; code: string; retryable: boolean } => {
    const http = (
      registry as unknown as { upstreamError: (e: unknown) => HttpError }
    ).upstreamError(error);
    return {
      status: http.statusCode,
      code: http.code,
      retryable: http.retryable,
    };
  };
  assert.deepEqual(
    map(registry, new EngineRequestError("not found", 404, "nf")),
    { status: 404, code: "resource_not_found", retryable: false },
  );
  assert.deepEqual(
    map(registry, new EngineRequestError("conflict", 409, "cf")),
    { status: 409, code: "engine_conflict", retryable: false },
  );
  assert.deepEqual(
    map(registry, new EngineRequestError("bad input", 400, "bi")),
    { status: 400, code: "engine_rejected", retryable: false },
  );
  assert.deepEqual(map(registry, new EngineRequestError("boom", 500, "boom")), {
    status: 502,
    code: "engine_unavailable",
    retryable: true,
  });
  assert.deepEqual(map(registry, new Error("ECONNREFUSED")), {
    status: 502,
    code: "engine_unavailable",
    retryable: true,
  });
});

test("list reads mark offline on failure; dashboard failure goes 502", async () => {
  const { registry } = makeRegistry();
  const listClient = clientStub({
    listContainers: async () => {
      throw new Error("socket hang up");
    },
  });
  const listRecord = makeRecord(listClient, "unknown");
  inject(registry, listRecord);
  await assertHttpError(
    registry.listContainers("h1"),
    502,
    "engine_unavailable",
  );
  assert.equal(listRecord.publicHost.status, "offline");
  assert.equal(listRecord.lastError, "socket hang up");

  const dashClient = clientStub({
    getInfo: async () => {
      throw new EngineRequestError("gateway said no", 502, "up");
    },
    listContainers: async () => [],
    listVolumes: async () => [],
    listNetworks: async () => [],
  });
  const dashRecord = makeRecord(dashClient, "unknown", "h2");
  inject(registry, dashRecord);
  await assertHttpError(registry.dashboard("h2"), 502, "engine_unavailable");
  assert.equal(dashRecord.publicHost.status, "offline");
});

test("mutations are rejected while offline but proceed when online", async () => {
  const { registry } = makeRegistry();
  const offline = makeRecord(clientStub(), "offline");
  inject(registry, offline);
  await assertHttpError(
    registry.containerAction("h1", "c1", "start"),
    409,
    "host_unavailable",
  );
  await assertHttpError(
    registry.deleteImage("h1", "img", false),
    409,
    "host_unavailable",
  );

  const online = makeRecord(
    clientStub({
      actionContainer: async () => {},
      pullImage: async () => {},
    }),
    "online",
    "h2",
  );
  inject(registry, online);
  await registry.containerAction("h2", "c1", "stop");
  await registry.pullImage("h2", { image: "nginx" });
  assert.equal(online.publicHost.status, "online");
});

test("4xx engine errors keep the host online; 5xx and network errors do not", async () => {
  const { registry } = makeRegistry();
  const ok404 = makeRecord(
    clientStub({
      inspectImage: async () => {
        throw new EngineRequestError("no such image", 404, "nf");
      },
    }),
    "online",
    "h1",
  );
  inject(registry, ok404);
  await assertHttpError(
    registry.inspectImage("h1", "img1"),
    404,
    "resource_not_found",
  );
  assert.equal(ok404.publicHost.status, "online");

  const five = makeRecord(
    clientStub({
      inspectImage: async () => {
        throw new EngineRequestError("internal", 500, "ie");
      },
    }),
    "online",
    "h2",
  );
  inject(registry, five);
  await assertHttpError(
    registry.inspectImage("h2", "img1"),
    502,
    "engine_unavailable",
  );
  assert.equal(five.publicHost.status, "offline");

  const net = makeRecord(
    clientStub({
      inspectImage: async () => {
        throw new Error("ECONNRESET");
      },
    }),
    "online",
    "h3",
  );
  inject(registry, net);
  await assertHttpError(
    registry.inspectImage("h3", "img1"),
    502,
    "engine_unavailable",
  );
  assert.equal(net.publicHost.status, "offline");
});

test("cancelled operations are rethrown without marking the host offline", async () => {
  const { registry } = makeRegistry();
  const record = makeRecord(
    clientStub({
      pullImage: async () => {
        throw { code: "operation_cancelled", message: "cancelled" };
      },
    }),
    "online",
  );
  inject(registry, record);
  await assert.rejects(
    registry.pullImage("h1", { image: "nginx" }),
    (error: unknown) =>
      (error as { code?: string }).code === "operation_cancelled",
  );
  assert.equal(record.publicHost.status, "online");
});

test("pruneResources dispatches by kind and re-marks online", async () => {
  const calls: string[] = [];
  const summary = { freedBytes: 123, containersDeleted: ["c9"] };
  const client = clientStub({
    pruneContainers: async () => {
      calls.push("containers");
      return summary;
    },
    pruneImages: async () => {
      calls.push("images");
      return summary;
    },
    pruneVolumes: async () => {
      calls.push("volumes");
      return summary;
    },
    pruneNetworks: async () => {
      calls.push("networks");
      return summary;
    },
  });
  const record = makeRecord(client, "online");
  const { registry } = makeRegistry();
  inject(registry, record);
  assert.deepEqual(
    await registry.pruneResources("h1", "containers", true),
    summary,
  );
  assert.deepEqual(await registry.pruneResources("h1", "images"), summary);
  assert.deepEqual(await registry.pruneResources("h1", "volumes"), summary);
  assert.deepEqual(await registry.pruneResources("h1", "networks"), summary);
  assert.deepEqual(calls, ["containers", "images", "volumes", "networks"]);
  assert.equal(record.publicHost.status, "online");
});

test("terminal sessions move created to running to closed and 404 when unknown", async () => {
  const started: Array<{ execId: string; tty: boolean }> = [];
  const resized: Array<{ execId: string; rows: number; columns: number }> = [];
  const client = clientStub({
    createExec: async (
      _containerId: string,
      _command: string[],
      _tty?: boolean,
    ) => "exec-7",
    startExec: async (execId: string, tty: boolean) => {
      started.push({ execId, tty });
      return {};
    },
    resizeExec: async (execId: string, rows: number, columns: number) => {
      resized.push({ execId, rows, columns });
    },
  });
  const record = makeRecord(client, "online");
  const { registry } = makeRegistry();
  inject(registry, record);

  const session = await registry.createTerminalSession("h1", "c1", "top");
  assert.equal(session.hostId, "h1");
  assert.equal(session.containerId, "c1");
  assert.equal(session.status, "created");
  assert.ok(session.createdAt);

  assert.throws(
    () => registry.getTerminalSession("missing"),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 404 &&
      error.code === "terminal_session_not_found",
  );

  await registry.startTerminalSession(session.id);
  assert.equal(
    registry.getTerminalSession(session.id).session.status,
    "running",
  );
  assert.deepEqual(started, [{ execId: "exec-7", tty: true }]);

  await registry.resizeTerminalSession(session.id, 40, 120);
  assert.deepEqual(resized, [{ execId: "exec-7", rows: 40, columns: 120 }]);

  registry.closeTerminalSession(session.id);
  assert.equal(
    registry.getTerminalSession(session.id).session.status,
    "closed",
  );
  registry.closeTerminalSession("missing");
});

test("terminal session create fails 409 while offline", async () => {
  const record = makeRecord(clientStub(), "offline");
  const { registry } = makeRegistry();
  inject(registry, record);
  await assertHttpError(
    registry.createTerminalSession("h1", "c1", "top"),
    409,
    "host_unavailable",
  );
});

test("watchEvents publishes engine envelopes, skips malformed lines, and reconnects", async () => {
  const events = new EventHub();
  const registry = new HostRegistry({ config: baseConfig, events });
  const lines = [
    JSON.stringify({
      Type: "container",
      Action: "start",
      action: "start",
      id: "c1",
      time: 1788000000,
    }),
    "garbage-not-json",
    JSON.stringify({ Type: "IMAGE", status: "pull", time: 1788000001 }),
  ].join("\n");
  let streamCount = 0;
  let streamDone = false;
  const client = clientStub({
    createEventStream: async function* () {
      streamCount += 1;
      yield lines + "\n";
      streamDone = true;
    } as never,
  });
  const record = makeRecord(client, "offline");
  inject(registry, record);
  void (
    registry as unknown as {
      watchEvents: (id: string, r: FakeRecord) => Promise<void>;
    }
  ).watchEvents("h1", record);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(streamDone);
  assert.equal(record.publicHost.status, "online");
  const envelopes = events.since();
  assert.equal(envelopes.length, 2);
  assert.equal(envelopes[0]!.hostId, "h1");
  assert.equal(envelopes[0]!.type, "engine.start");
  assert.equal(envelopes[0]!.resourceKind, "container");
  assert.equal(envelopes[0]!.resourceId, "c1");
  assert.equal(
    envelopes[0]!.occurredAt,
    new Date(1788000000 * 1000).toISOString(),
  );
  assert.equal(envelopes[1]!.type, "engine.pull");
  assert.equal(envelopes[1]!.resourceKind, "image");
  assert.equal(envelopes[1]!.resourceId, undefined);
  await registry.close();
  await new Promise((resolve) => setTimeout(resolve, 3100));
  assert.equal(streamCount, 1);
});
test("dependencyStatus reflects host presence and health", () => {
  const { registry } = makeRegistry();
  assert.equal(registry.dependencyStatus(), "not-configured");
  inject(registry, makeRecord(clientStub(), "offline"));
  assert.equal(registry.dependencyStatus(), "unavailable");
  inject(registry, makeRecord(clientStub(), "online", "h2"));
  assert.equal(registry.dependencyStatus(), "ok");
});
