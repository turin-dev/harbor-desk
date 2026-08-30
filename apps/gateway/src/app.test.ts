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

test("tracks prune operations and audit results for a host without an Engine", async (t) => {
  const harbor = await buildApp(testConfig);
  t.after(async () => harbor.app.close());
  const host = await harbor.registry.add({
    displayName: "Prune test engine",
    endpoint: "http://127.0.0.1:1",
  });

  const badKind = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + host.id + "/prune/volumes-2",
  });
  assert.equal(badKind.statusCode, 400);
  assert.equal(badKind.json().error.code, "validation_error");

  const unknownHost = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/does-not-exist/prune/images",
  });
  assert.equal(unknownHost.statusCode, 403);
  assert.equal(unknownHost.json().error.code, "host_access_denied");

  const prune = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + host.id + "/prune/images?all=true",
  });
  assert.equal(prune.statusCode, 202);
  const operation = prune.json().data;
  assert.equal(operation.status, "failed");
  assert.equal(operation.kind, "prune.images");
  assert.equal(operation.error.code, "host_unavailable");
  assert.ok(operation.finishedAt);

  const audit = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/audit?limit=50",
  });
  assert.equal(audit.statusCode, 200);
  const entries = audit.json().data as Array<{
    action?: unknown;
    result?: unknown;
  }>;
  const pruneAudit = entries.find(
    (entry) => entry.action === "prune.images" && entry.result === "failure",
  );
  assert.ok(pruneAudit, "expected a failed prune audit entry");
  assert.ok(
    entries.some(
      (entry) => entry.action === "prune.images" && entry.result === "denied",
    ),
    "expected a denied prune audit entry for the unknown host",
  );
});

test("reports operation progress and cancel outcomes", async (t) => {
  const harbor = await buildApp(testConfig);
  t.after(async () => harbor.app.close());
  const host = await harbor.registry.add({
    displayName: "Operations engine",
    endpoint: "http://127.0.0.1:1",
  });
  const prune = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + host.id + "/prune/containers",
  });
  assert.equal(prune.statusCode, 202);
  const operation = prune.json().data;

  harbor.operations.setProgress(operation.id, 42, "Half cleaned");
  const mid = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/operations/" + operation.id,
  });
  assert.equal(mid.statusCode, 200);
  assert.equal(mid.json().data.progress, 42);
  assert.equal(mid.json().data.message, "Half cleaned");

  const missing = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/operations/not-an-operation",
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "operation_not_found");

  const cancelMissing = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/operations/not-an-operation/cancel",
  });
  assert.equal(cancelMissing.statusCode, 404);
  assert.equal(cancelMissing.json().error.code, "operation_not_found");
});

test("surfaces pull progress through operation polling for a live Engine", async (t) => {
  const harbor = await buildApp(testConfig);
  t.after(async () => harbor.app.close());
  const host = await harbor.registry.add({
    displayName: "Pull progress engine",
    endpoint: "http://127.0.0.1:1",
  });
  const records = (
    harbor.registry as unknown as {
      records: Map<string, { client: Record<string, unknown> }>;
    }
  ).records.get(host.id);
  assert.ok(records, "expected the seeded host record");
  records.client.probe = async () => ({
    summary: {
      id: "probe-1",
      version: "27.0.0",
      apiVersion: "1.47",
      minApiVersion: "1.12",
      operatingSystem: "linux",
      architecture: "amd64",
      containers: 0,
      containersRunning: 0,
      containersStopped: 0,
      images: 0,
      memoryTotalBytes: 0,
    },
    capabilities: {
      containers: true,
      images: true,
      volumes: true,
      networks: true,
      logs: true,
      stats: true,
      exec: true,
      compose: false,
      buildkit: true,
      kubernetes: false,
      extensions: false,
      imageScan: false,
      volumeFileBrowser: false,
    },
  });
  records.client.createEventStream = async () => (async function* () {})();
  records.client.requestStream = async () => (async function* () {})();
  await harbor.registry.test(host.id);
  records.client.pullImage = async (
    _input: unknown,
    onProgress?: (frame: { status: string; id?: string }) => void,
  ) => {
    onProgress?.({ status: "Waiting", id: "nginx" });
    onProgress?.({ status: "Downloading", id: "layer-1" });
    onProgress?.({ status: "Download complete", id: "layer-1" });
    onProgress?.({ status: "Pull complete", id: "layer-1" });
  };
  const pull = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + host.id + "/images/pull",
    headers: { "operation-id": "pull-progress-op-1" },
    payload: { image: "nginx:1.27" },
  });
  assert.equal(pull.statusCode, 202);
  const operation = pull.json().data;
  assert.equal(operation.id, "pull-progress-op-1");
  assert.equal(operation.status, "succeeded");
  assert.equal(operation.progress, 100);

  const polled = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/operations/pull-progress-op-1",
  });
  assert.equal(polled.statusCode, 200);
  assert.equal(polled.json().data.status, "succeeded");
});

test("cancels a running pull, aborts the Engine request, and keeps the host online", async (t) => {
  const harbor = await buildApp(testConfig);
  t.after(async () => harbor.app.close());
  const host = await harbor.registry.add({
    displayName: "Pull cancel engine",
    endpoint: "http://127.0.0.1:1",
  });
  const records = (
    harbor.registry as unknown as {
      records: Map<string, { client: Record<string, unknown> }>;
    }
  ).records.get(host.id);
  assert.ok(records, "expected the seeded host record");
  records.client.probe = async () => ({
    summary: {
      id: "probe-2",
      version: "27.0.0",
      apiVersion: "1.47",
      minApiVersion: "1.12",
      operatingSystem: "linux",
      architecture: "amd64",
      containers: 0,
      containersRunning: 0,
      containersStopped: 0,
      images: 0,
      memoryTotalBytes: 0,
    },
    capabilities: {
      containers: true,
      images: true,
      volumes: true,
      networks: true,
      logs: true,
      stats: true,
      exec: true,
      compose: false,
      buildkit: true,
      kubernetes: false,
      extensions: false,
      imageScan: false,
      volumeFileBrowser: false,
    },
  });
  records.client.createEventStream = async () => (async function* () {})();
  records.client.requestStream = async () => (async function* () {})();
  await harbor.registry.test(host.id);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await harbor.registry.test(host.id);
  records.client.pullImage = async (
    _input: unknown,
    _onProgress?: (frame: { status: string; id?: string }) => void,
    signal?: AbortSignal,
  ) => {
    await new Promise<void>((_resolve, reject) => {
      signal?.addEventListener(
        "abort",
        () =>
          reject(
            Object.assign(new Error("aborted"), {
              code: "operation_cancelled",
            }),
          ),
        { once: true },
      );
    });
  };
  const pull = harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + host.id + "/images/pull",
    headers: { "operation-id": "pull-cancel-op-1" },
    payload: { image: "nginx:1.27" },
  });
  let running = false;
  for (let i = 0; i < 100 && !running; i += 1) {
    const polled = await harbor.app.inject({
      method: "GET",
      url: "/api/v1/operations/pull-cancel-op-1",
    });
    if (polled.statusCode === 200 && polled.json().data.status === "running")
      running = true;
    else await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(running, "expected the pull operation to reach running");
  const cancel = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/operations/pull-cancel-op-1/cancel",
  });
  assert.equal(cancel.statusCode, 200);
  assert.equal(cancel.json().data.status, "cancelled");
  const pullResponse = await pull;
  assert.equal(pullResponse.statusCode, 202);
  assert.equal(pullResponse.json().data.status, "cancelled");
  const hosts = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hosts",
  });
  const cancelledHost = hosts
    .json()
    .data.find((item: { id: string }) => item.id === host.id);
  assert.equal(cancelledHost.status, "online");
  const audit = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/audit",
  });
  assert.ok(
    audit
      .json()
      .data.some(
        (entry: { action: string; result: string }) =>
          entry.action === "operation.cancel" && entry.result === "success",
      ),
    "expected a successful operation.cancel audit entry",
  );
});

test("validates container creation input and audit limits", async (t) => {
  const harbor = await buildApp(testConfig);
  t.after(async () => harbor.app.close());
  const host = await harbor.registry.add({
    displayName: "Validation engine",
    endpoint: "http://127.0.0.1:1",
  });
  const badPort = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + host.id + "/containers",
    payload: {
      image: "nginx:1.27",
      ports: [{ containerPort: 70000, protocol: "tcp" }],
    },
  });
  assert.equal(badPort.statusCode, 400);
  assert.equal(badPort.json().error.code, "validation_error");

  const badRestart = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + host.id + "/containers",
    payload: { image: "nginx:1.27", restartPolicy: "sometimes" },
  });
  assert.equal(badRestart.statusCode, 400);
  assert.equal(badRestart.json().error.code, "validation_error");

  const missingImage = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + host.id + "/containers",
    payload: {},
  });
  assert.equal(missingImage.statusCode, 400);
  assert.equal(missingImage.json().error.code, "validation_error");

  const badAuditLimit = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/audit?limit=abc",
  });
  assert.equal(badAuditLimit.statusCode, 400);
  assert.equal(badAuditLimit.json().error.code, "validation_error");
});

test("cancels a running prune, aborts the Engine request, and keeps the host online", async (t) => {
  const harbor = await buildApp(testConfig);
  t.after(async () => harbor.app.close());
  const host = await harbor.registry.add({
    displayName: "Prune cancel engine",
    endpoint: "http://127.0.0.1:1",
  });
  const records = (
    harbor.registry as unknown as {
      records: Map<string, { client: Record<string, unknown> }>;
    }
  ).records.get(host.id);
  assert.ok(records, "expected the seeded host record");
  records.client.probe = async () => ({
    summary: {
      id: "probe-3",
      version: "27.0.0",
      apiVersion: "1.47",
      minApiVersion: "1.12",
      operatingSystem: "linux",
      architecture: "amd64",
      containers: 0,
      containersRunning: 0,
      containersStopped: 0,
      images: 0,
      memoryTotalBytes: 0,
    },
    capabilities: {
      containers: true,
      images: true,
      volumes: true,
      networks: true,
      logs: true,
      stats: true,
      exec: true,
      compose: false,
      buildkit: true,
      kubernetes: false,
      extensions: false,
      imageScan: false,
      volumeFileBrowser: false,
    },
  });
  records.client.createEventStream = async () => (async function* () {})();
  records.client.requestStream = async () => (async function* () {})();
  await harbor.registry.test(host.id);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await harbor.registry.test(host.id);
  records.client.pruneVolumes = (signal?: AbortSignal) =>
    new Promise<void>((_resolve, reject) => {
      signal?.addEventListener(
        "abort",
        () =>
          reject(
            Object.assign(new Error("aborted"), {
              code: "operation_cancelled",
            }),
          ),
        { once: true },
      );
    });
  const prune = harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + host.id + "/prune/volumes?all=false",
    headers: { "operation-id": "prune-cancel-op-1" },
  });
  let running = false;
  for (let i = 0; i < 100 && !running; i += 1) {
    const polled = await harbor.app.inject({
      method: "GET",
      url: "/api/v1/operations/prune-cancel-op-1",
    });
    if (polled.statusCode === 200 && polled.json().data.status === "running")
      running = true;
    else await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(running, "expected the prune operation to reach running");
  const cancel = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/operations/prune-cancel-op-1/cancel",
  });
  assert.equal(cancel.statusCode, 200);
  assert.equal(cancel.json().data.status, "cancelled");
  const pruneResponse = await prune;
  assert.equal(pruneResponse.statusCode, 202);
  assert.equal(pruneResponse.json().data.status, "cancelled");
  const hosts = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hosts",
  });
  const cancelledHost = hosts
    .json()
    .data.find((item: { id: string }) => item.id === host.id);
  assert.equal(cancelledHost.status, "online");
});

test("covers host re-probe, capabilities, removal, and container action routes", async (t) => {
  const harbor = await buildApp(testConfig);
  t.after(async () => harbor.app.close());
  const host = await harbor.registry.add({
    displayName: "Route coverage engine",
    endpoint: "http://127.0.0.1:1",
  });

  const reprobe = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + host.id + "/test",
  });
  assert.equal(reprobe.statusCode, 200);
  assert.equal(reprobe.json().data.status, "offline");

  const caps = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hosts/" + host.id + "/capabilities",
  });
  assert.equal(caps.statusCode, 200);
  assert.equal(caps.json().data.containers, false);
  assert.equal(caps.json().data.imageScan, false);

  const unknownHostAction = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/does-not-exist/containers/abc/stop",
  });
  assert.equal(unknownHostAction.statusCode, 403);
  assert.equal(unknownHostAction.json().error.code, "host_access_denied");

  const badAction = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + host.id + "/containers/abc/freeze",
  });
  assert.equal(badAction.statusCode, 400);
  assert.equal(badAction.json().error.code, "validation_error");

  const stop = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + host.id + "/containers/abc/stop",
  });
  assert.equal(stop.statusCode, 202);
  const operation = stop.json().data;
  assert.equal(operation.status, "failed");
  assert.equal(operation.kind, "container.stop");
  assert.equal(operation.error.code, "host_unavailable");

  const remove = await harbor.app.inject({
    method: "DELETE",
    url: "/api/v1/hosts/" + host.id,
  });
  assert.equal(remove.statusCode, 204);

  const hosts = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hosts",
  });
  assert.deepEqual(hosts.json().data, []);

  const capsAfterRemove = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hosts/" + host.id + "/capabilities",
  });
  assert.equal(capsAfterRemove.statusCode, 403);
  assert.equal(capsAfterRemove.json().error.code, "host_access_denied");
});

test("normalizes Docker Hub search responses", async (t) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const harbor = await buildApp(testConfig, {
    hubTransport: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          query: "nginx",
          result_count: 12,
          results: [
            {
              repo_name: "library/nginx",
              description: "Official Nginx image",
              star_count: 30000,
              pull_count: 9000000000,
              is_official: true,
              repository_type: "image",
            },
            { repo_name: "nginx", star_count: 900 },
            { junk: true },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  t.after(async () => harbor.app.close());

  const response = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hub/search?q=nginx&limit=25",
  });
  assert.equal(response.statusCode, 200);
  const data = response.json().data;
  assert.equal(data.query, "nginx");
  assert.equal(data.resultCount, 12);
  assert.equal(data.results.length, 2);
  assert.equal(data.results[0].repository, "library/nginx");
  assert.equal(data.results[0].starCount, 30000);
  assert.equal(data.results[0].pullCount, 9000000000);
  assert.equal(data.results[0].isOfficial, true);
  assert.equal(data.results[1].description, undefined);
  assert.equal(data.results[1].isOfficial, false);
  assert.equal(calls.length, 1);
  assert.match(
    calls[0]!.url,
    /registry-1.docker\.io\/v2\/search\/repositories\?q=nginx&page_size=25\b/,
  );
  const events = harbor.audit.list(500);
  assert.equal(
    events.find((event) => event.action === "hub.search")?.resourceId,
    "nginx",
  );
});

test("validates Docker Hub search query input", async (t) => {
  const harbor = await buildApp(testConfig, {
    hubTransport: async () => new Response("{}", { status: 200 }),
  });
  t.after(async () => harbor.app.close());

  const missing = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hub/search",
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error.code, "validation_error");

  const long = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hub/search?q=" + "a".repeat(129),
  });
  assert.equal(long.statusCode, 400);
  assert.equal(long.json().error.code, "validation_error");

  const badLimit = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hub/search?q=nginx&limit=51",
  });
  assert.equal(badLimit.statusCode, 400);
  assert.equal(badLimit.json().error.code, "validation_error");
});

test("maps Docker Hub rate limits and unexpected responses", async (t) => {
  const harbor = await buildApp(testConfig, {
    hubTransport: async () => new Response(null, { status: 429 }),
  });
  t.after(async () => harbor.app.close());

  const rateLimited = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hub/search?q=nginx",
  });
  assert.equal(rateLimited.statusCode, 429);
  assert.equal(rateLimited.json().error.code, "hub_rate_limited");
  assert.equal(rateLimited.json().error.retryable, true);

  const unexpected = await buildApp(testConfig, {
    hubTransport: async () => new Response("nope", { status: 500 }),
  });
  t.after(async () => unexpected.app.close());
  const response = await unexpected.app.inject({
    method: "GET",
    url: "/api/v1/hub/search?q=nginx",
  });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error.code, "hub_unavailable");
});

test("maps Docker Hub network failures to a retryable error", async (t) => {
  const harbor = await buildApp(testConfig, {
    hubTransport: async () => {
      throw new Error("socket hang up");
    },
  });
  t.after(async () => harbor.app.close());

  const response = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hub/search?q=nginx",
  });
  assert.equal(response.statusCode, 502);
  const error = response.json().error;
  assert.equal(error.code, "hub_unavailable");
  assert.equal(error.retryable, true);
});
