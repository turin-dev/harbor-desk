import test from "node:test";
import assert from "node:assert/strict";
import { DockerEngineClient, HttpError } from "./index.js";
test("accepts server-side HTTPS Engine endpoints and rejects unsupported protocols", () => {
  assert.doesNotThrow(
    () => new DockerEngineClient({ endpoint: "https://engine.internal:2376" }),
  );
  assert.throws(
    () => new DockerEngineClient({ endpoint: "ftp://engine.internal:21" }),
    /http, https, npipe, or unix/,
  );
});
test("supports the Windows development named pipe connector without exposing it as a client concern", () => {
  const client = new DockerEngineClient({
    endpoint: "npipe:////./pipe/dockerDesktopLinuxEngine",
  });
  assert.ok(client);
});
test("creates stable-looking event cursors for upstream events", () => {
  const event = {
    timeNano: 10_000,
    type: "container",
    Type: "container",
    action: "start",
  };
  const first = DockerEngineClient.eventCursor(event);
  const second = DockerEngineClient.eventCursor(event);
  assert.equal(first, second);
  assert.match(first, /^10000-[a-f0-9]{20}$/);
});

test("consumes pull progress frames and propagates engine pull errors", async () => {
  const client = new DockerEngineClient({ endpoint: "http://127.0.0.1:1" });
  const stream = async function* () {
    yield '{"status":"Waiting","id":"nginx"}\n';
    yield "plain docker log line\n";
    yield '{"status":"Downloading","progress":"50%"}\n';
    yield '{"error":"boom"}\n';
  };
  (client as unknown as { requestStream: unknown }).requestStream = (
    _path: string,
    options?: { method?: string },
  ) => {
    assert.equal(options?.method, "POST");
    return stream();
  };
  const frames: Array<{ status?: string; progress?: string }> = [];
  await assert.rejects(
    client.pullImage({ image: "nginx:1.27" }, (frame) => frames.push(frame)),
    /boom/,
  );
  assert.deepEqual(
    frames.map((frame) => frame.status),
    ["Waiting", "Downloading"],
  );
});

test("aborts a running image pull with a deterministic operation_cancelled error", async () => {
  const client = new DockerEngineClient({ endpoint: "http://127.0.0.1:1" });
  const controller = new AbortController();
  const openStream = async function* () {
    yield '{"status":"Waiting","id":"nginx"}\n';
    await new Promise<void>(() => undefined);
  };
  (client as unknown as { requestStream: unknown }).requestStream = (
    _path: string,
    options?: { signal?: AbortSignal },
  ) => {
    assert.equal(options?.signal, controller.signal);
    return Promise.resolve(openStream());
  };
  const pending = client.pullImage(
    { image: "nginx:1.27" },
    undefined,
    controller.signal,
  );
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === "operation_cancelled" &&
      /cancelled/i.test(error.message),
  );
});

test("fails fast when a pull signal is already aborted", async () => {
  const client = new DockerEngineClient({ endpoint: "http://127.0.0.1:1" });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    client.pullImage({ image: "nginx:1.27" }, undefined, controller.signal),
    (error: unknown) =>
      error instanceof HttpError && error.code === "operation_cancelled",
  );
});
test("maps prune endpoints to a normalized prune summary", async () => {
  const containers = new DockerEngineClient({ endpoint: "http://127.0.0.1:1" });
  (containers as unknown as { requestJson: unknown }).requestJson = async (
    path: string,
  ) => {
    assert.equal(path, "/containers/prune?all=1");
    return { SpaceReclaimed: 1234, ContainersDeleted: ["c1"] };
  };
  assert.deepEqual(await containers.pruneContainers(true), {
    freedBytes: 1234,
    containersDeleted: ["c1"],
  });
  const images = new DockerEngineClient({ endpoint: "http://127.0.0.1:1" });
  (images as unknown as { requestJson: unknown }).requestJson = async (
    path: string,
  ) => {
    assert.equal(path, "/images/prune?all=0");
    return {
      ImagesDeleted: [{ Digest: "sha256:abc", Untagged: "nginx:1.27" }],
      SpaceReclaimed: 4321,
    };
  };
  assert.deepEqual(await images.pruneImages(false), {
    freedBytes: 4321,
    imagesDeleted: [{ Digest: "sha256:abc", Untagged: "nginx:1.27" }],
  });
  const volumes = new DockerEngineClient({ endpoint: "http://127.0.0.1:1" });
  (volumes as unknown as { requestJson: unknown }).requestJson = async (
    path: string,
  ) => {
    assert.equal(path, "/volumes/prune");
    return { VolumesDeleted: ["v1", "v2"] };
  };
  assert.deepEqual(await volumes.pruneVolumes(), {
    volumesDeleted: ["v1", "v2"],
  });
  const networks = new DockerEngineClient({ endpoint: "http://127.0.0.1:1" });
  (networks as unknown as { requestJson: unknown }).requestJson = async (
    path: string,
  ) => {
    assert.equal(path, "/networks/prune");
    return { NetworksDeleted: ["n1"] };
  };
  assert.deepEqual(await networks.pruneNetworks(), {
    networksDeleted: ["n1"],
  });
});
test("builds the Docker Engine container create body from run options", async () => {
  const client = new DockerEngineClient({ endpoint: "http://127.0.0.1:1" });
  let path = "";
  let options: { body?: unknown } = {};
  (client as unknown as { requestJson: unknown }).requestJson = async (
    requested: string,
    opts: { body?: unknown } = {},
  ) => {
    path = requested;
    options = opts;
    return { Id: "container-1" };
  };
  const id = await client.createContainer({
    image: "nginx:1.27",
    name: "web",
    command: "echo hi",
    restartPolicy: "unless-stopped",
    labels: { app: "harbor" },
    env: [{ name: "MODE", value: "test" }],
    ports: [
      { containerPort: 8080, hostPort: 80, protocol: "tcp" },
      { containerPort: 53, protocol: "udp" },
    ],
  });
  assert.equal(id, "container-1");
  assert.equal(path, "/containers/create?name=web");
  const body = options.body as Record<string, unknown>;
  assert.equal(body.Image, "nginx:1.27");
  assert.deepEqual(body.Cmd, ["sh", "-lc", "echo hi"]);
  assert.deepEqual(body.RestartPolicy, { Name: "unless-stopped" });
  assert.deepEqual(body.Labels, { app: "harbor" });
  assert.deepEqual(body.Env, ["MODE=test"]);
  assert.deepEqual(body.ExposedPorts, {
    "8080/tcp": {},
    "53/udp": {},
  });
  assert.deepEqual(body.PortBindings, {
    "8080/tcp": [{ HostPort: "80" }],
    "53/udp": [{}],
  });
});
