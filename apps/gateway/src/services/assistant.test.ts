import test from "node:test";
import assert from "node:assert/strict";
import type {
  ContainerSummary,
  ImageSummary,
  NetworkSummary,
  VolumeSummary,
} from "@harbor/contracts";
import { HttpError } from "../errors.js";
import { AssistantService, type AssistantRegistryLike } from "./assistant.js";
import type { Host } from "@harbor/contracts";

const host: Host = {
  id: "host-1",
  displayName: "workstation",
  status: "online",
  capabilities: {
    containers: true,
    images: true,
    volumes: true,
    networks: true,
    logs: true,
    stats: true,
    exec: true,
    compose: false,
    buildkit: false,
    kubernetes: false,
    extensions: false,
    imageScan: false,
    volumeFileBrowser: false,
  },
  connectionMode: "development-socket",
};

function container(
  overrides: Partial<ContainerSummary> = {},
): ContainerSummary {
  return {
    id: "c1",
    name: "app",
    image: "nginx:1.27",
    state: "running",
    status: "Up 5 minutes",
    ports: [],
    labels: {},
    hostId: "host-1",
    ...overrides,
  };
}

function image(overrides: Partial<ImageSummary> = {}): ImageSummary {
  return {
    id: "sha256:" + "a".repeat(64),
    repository: "nginx",
    tag: "1.27",
    hostId: "host-1",
    ...overrides,
  };
}

function volume(overrides: Partial<VolumeSummary> = {}): VolumeSummary {
  return {
    name: "cache",
    driver: "local",
    mountpoint: "/data",
    hostId: "host-1",
    ...overrides,
  };
}

function network(overrides: Partial<NetworkSummary> = {}): NetworkSummary {
  return {
    id: "n1",
    name: "bridge",
    driver: "bridge",
    scope: "local",
    internal: false,
    hostId: "host-1",
    ...overrides,
  };
}

function makeRegistry(
  overrides: Partial<AssistantRegistryLike> = {},
): AssistantRegistryLike {
  const calls: Array<string[]> = [];
  const callsRef = { calls };
  (
    makeRegistry as unknown as { callsRef?: { calls: Array<string[]> } }
  ).callsRef = callsRef;
  const registry: AssistantRegistryLike = {
    list: () => [host],
    dashboard: async () => ({}),
    listContainers: async () => [container()],
    listImages: async () => [image()],
    listVolumes: async () => [volume()],
    listNetworks: async () => [network()],
    containerAction: async (
      hostId: string,
      containerId: string,
      action: string,
    ) => {
      calls.push(["containerAction", hostId, containerId, action]);
    },
    deleteImage: async (hostId: string, imageId: string, force: boolean) => {
      calls.push(["deleteImage", hostId, imageId, String(force)]);
    },
    deleteVolume: async (hostId: string, name: string, force: boolean) => {
      calls.push(["deleteVolume", hostId, name, String(force)]);
    },
    deleteNetwork: async (hostId: string, networkId: string) => {
      calls.push(["deleteNetwork", hostId, networkId]);
    },
    ...overrides,
  };
  return registry;
}

function callsOf(registry: AssistantRegistryLike): Array<string[]> {
  return (makeRegistry as unknown as { callsRef: { calls: Array<string[]> } })
    .callsRef.calls;
}

test("assistant: flags failed and restarting containers plus cleanup opportunities", async () => {
  const registry = makeRegistry({
    listContainers: async () => [
      container({
        id: "ok",
        name: "ok",
        state: "running",
        status: "Up 2 hours",
      }),
      container({
        id: "ex1",
        name: "broken",
        state: "exited",
        status: "Exited (1) 5 minutes ago",
      }),
      container({
        id: "loop",
        name: "loop",
        state: "restarting",
        status: "Restarting (1) 30 seconds ago",
      }),
    ],
    listImages: async () => [
      image(),
      image({
        id: "sha256:" + "b".repeat(64),
        repository: "<none>",
        tag: "<none>",
      }),
    ],
    listVolumes: async () => [
      volume(),
      volume({ name: "stale", mountpoint: undefined }),
    ],
    listNetworks: async () => [
      network(),
      network({ id: "n2", name: "unused-net" }),
    ],
  });
  const service = new AssistantService(registry);
  const analysis = await service.analyze("host-1");
  assert.equal(analysis.hostId, "host-1");
  const titles = analysis.insights.map((item) => item.title);
  assert.ok(
    titles.includes("Container exited with a non-zero code"),
    titles.join("; "),
  );
  assert.ok(titles.includes("Container is crash-looping"), titles.join("; "));
  assert.ok(titles.includes("Dangling image"), titles.join("; "));
  assert.ok(titles.includes("Unused volume"), titles.join("; "));
  assert.ok(titles.includes("Network may be unused"), titles.join("; "));
  const critical = analysis.insights.find(
    (item) => item.severity === "critical",
  );
  assert.ok(critical);
  assert.equal(critical.resourceId, "loop");
  const warning = analysis.insights.find((item) => item.severity === "warning");
  assert.ok(warning);
  assert.equal(warning.resourceId, "ex1");
  assert.ok(
    analysis.proposals.some(
      (item) => item.resourceKind === "image" && item.risk === "low",
    ),
  );
  assert.ok(
    analysis.proposals.some(
      (item) => item.resourceKind === "volume" && item.risk === "medium",
    ),
  );
});

test("assistant: healthy host reports no issues and no proposals", async () => {
  const registry = makeRegistry({
    listNetworks: async () => [network(), network({ name: "host" })],
  });
  const service = new AssistantService(registry);
  const analysis = await service.analyze("host-1");
  assert.equal(analysis.proposals.length, 0);
  assert.equal(analysis.insights.length, 1);
  assert.equal(analysis.insights[0]!.title, "No issues detected");
});

test("assistant: apply stop delegates to containerAction", async () => {
  const registry = makeRegistry();
  const service = new AssistantService(registry);
  const result = await service.apply("host-1", {
    resourceKind: "container",
    resourceId: "c1",
    action: "stop",
  });
  assert.deepEqual(result, { applied: true, resourceId: "c1", action: "stop" });
  assert.deepEqual(callsOf(registry), [
    ["containerAction", "host-1", "c1", "stop"],
  ]);
});

test("assistant: unsupported container action fails with 422", async () => {
  const registry = makeRegistry();
  const service = new AssistantService(registry);
  await assert.rejects(
    service.apply("host-1", {
      resourceKind: "container",
      resourceId: "c1",
      action: "restart",
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 422);
      assert.equal(error.code, "unsupported_action");
      return true;
    },
  );
});

test("assistant: unknown host fails with 404", async () => {
  const registry = makeRegistry();
  const service = new AssistantService(registry);
  await assert.rejects(service.analyze("missing"), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 404);
    assert.equal(error.code, "host_not_found");
    return true;
  });
  await assert.rejects(
    service.apply("missing", {
      resourceKind: "network",
      resourceId: "n1",
      action: "delete",
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 404);
      return true;
    },
  );
});
