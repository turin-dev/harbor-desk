import assert from "node:assert/strict";
import test from "node:test";
import type {
  ContainerSummary,
  ImageSummary,
  NetworkSummary,
  VolumeSummary,
} from "@harbor/contracts";
import { buildResults } from "./quick-search-results.js";

const empty = { containers: [], images: [], volumes: [], networks: [] };

function container(overrides: Partial<ContainerSummary>): ContainerSummary {
  return {
    id: "cid1",
    name: "web-app",
    image: "nginx:1.27",
    state: "running",
    status: "Up 2 hours",
    ports: [],
    labels: {},
    hostId: "h1",
    ...overrides,
  };
}

function image(overrides: Partial<ImageSummary>): ImageSummary {
  return {
    id: "sha256:abcdef1234567890",
    repository: "redis",
    tag: "7.4",
    hostId: "h1",
    ...overrides,
  };
}

function volume(overrides: Partial<VolumeSummary>): VolumeSummary {
  return {
    name: "db-data",
    driver: "local",
    scope: "local",
    hostId: "h1",
    ...overrides,
  };
}

function network(overrides: Partial<NetworkSummary>): NetworkSummary {
  return {
    id: "nid1",
    name: "backend",
    driver: "bridge",
    scope: "local",
    internal: false,
    hostId: "h1",
    ...overrides,
  };
}

test("returns no results for an empty query set", () => {
  assert.deepEqual(buildResults("nginx", empty), []);
});

test("matches containers by name, image, or status case-insensitively", () => {
  const resources = { ...empty, containers: [container({})] };

  const byName = buildResults("web", resources);
  assert.equal(byName.length, 1);
  assert.deepEqual(byName[0], {
    key: "container-cid1",
    kind: "container",
    label: "web-app",
    secondary: "nginx:1.27 \u00b7 Up 2 hours",
    path: "/containers",
  });

  const byImage = buildResults("NGINX", resources);
  assert.equal(byImage.length, 1);
  const byStatus = buildResults("up 2", resources);
  assert.equal(byStatus.length, 1);
  const miss = buildResults("postgres", resources);
  assert.deepEqual(miss, []);
});

test("matches images by repository:tag or digest and falls back to a short id", () => {
  const withDigest = {
    ...empty,
    images: [image({ digest: "sha256:cafe" })],
  };
  const byTag = buildResults("redis:7", withDigest);
  assert.equal(byTag.length, 1);
  assert.equal(byTag[0]!.label, "redis:7.4");
  assert.equal(byTag[0]!.secondary, "sha256:cafe");
  assert.equal(byTag[0]!.path, "/images");

  const byDigest = buildResults("CAFE", withDigest);
  assert.equal(byDigest.length, 1);

  const noDigest = {
    ...empty,
    images: [
      image({ digest: undefined, id: "sha256:1234567890abcdef12345678" }),
    ],
  };
  const byShortId = buildResults("1234567890abcdef12", noDigest);
  assert.equal(byShortId.length, 1);
  assert.equal(
    byShortId[0]!.secondary,
    "sha256:1234567890abcdef12".slice(0, 18),
  );
  assert.equal(byShortId[0]!.key, "image-sha256:1234567890abcdef12345678-7.4");
});

test("matches volumes by name, driver, or mountpoint", () => {
  const resources = {
    ...empty,
    volumes: [
      volume({ mountpoint: "/var/lib/postgresql" }),
      volume({ name: "cache", driver: "tmpfs", scope: undefined }),
    ],
  };

  const byMount = buildResults("postgresql", resources);
  assert.equal(byMount.length, 1);
  assert.equal(byMount[0]!.key, "volume-db-data");
  assert.equal(byMount[0]!.secondary, "local \u00b7 local");

  const byScopeFallback = buildResults("cache", resources);
  assert.equal(byScopeFallback.length, 1);
  assert.equal(byScopeFallback[0]!.secondary, "tmpfs \u00b7 unknown scope");
});

test("matches networks by name, driver, or scope", () => {
  const resources = { ...empty, networks: [network({})] };
  const byName = buildResults("back", resources);
  assert.equal(byName.length, 1);
  assert.deepEqual(byName[0], {
    key: "network-nid1",
    kind: "network",
    label: "backend",
    secondary: "bridge \u00b7 local",
    path: "/networks",
  });
  assert.equal(buildResults("bridge", resources).length, 1);
  assert.deepEqual(buildResults("overlay", resources), []);
});

test("caps the result list at twelve entries preserving order", () => {
  const resources = {
    ...empty,
    containers: Array.from({ length: 15 }, (_, i) =>
      container({ id: "c" + i, name: "shared-" + i }),
    ),
  };
  const results = buildResults("shared", resources);
  assert.equal(results.length, 12);
  assert.equal(results[0]!.label, "shared-0");
  assert.equal(results[11]!.label, "shared-11");
});
