import test from "node:test";
import assert from "node:assert/strict";
import { DockerEngineClient } from "./index.js";

function stubbedProbe(
  version: Record<string, unknown>,
  info: Record<string, unknown>,
) {
  const client = new DockerEngineClient({ endpoint: "http://127.0.0.1:1" });
  const seen: string[] = [];
  (client as unknown as { requestJson: unknown }).requestJson = async (
    path: string,
  ) => {
    seen.push(path);
    if (path === "/version") return version;
    if (path === "/info") return info;
    throw new Error("unexpected path: " + path);
  };
  return { client, seen };
}

test("probe maps Engine version and info into the summary and capability matrix", async () => {
  const { client, seen } = stubbedProbe(
    { Version: "29.6.2", ApiVersion: "1.51", MinAPIVersion: "1.24" },
    {
      ID: "abc123",
      ServerVersion: "29.6.2",
      ApiVersion: "1.51",
      MinAPIVersion: "1.24",
      OperatingSystem: "linux",
      Architecture: "x86_64",
      Containers: 10,
      ContainersRunning: 3,
      ContainersStopped: 7,
      Images: 20,
      MemTotal: 17179869184,
    },
  );
  const probe = await client.probe();
  assert.deepEqual(seen, ["/version", "/info"]);
  assert.deepEqual(probe.summary, {
    id: "abc123",
    version: "29.6.2",
    apiVersion: "1.51",
    minApiVersion: "1.24",
    operatingSystem: "linux",
    architecture: "x86_64",
    containers: 10,
    containersRunning: 3,
    containersStopped: 7,
    images: 20,
    memoryTotalBytes: 17179869184,
  });
  assert.deepEqual(probe.capabilities, {
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
  });
});

test("probe reports buildkit unavailable below API 1.39 and falls back to the info endpoint", async () => {
  const { client } = stubbedProbe(
    { Version: "20.10.24" },
    {
      ID: "def456",
      ServerVersion: "20.10.24",
      ApiVersion: "1.41",
      MinAPIVersion: "1.12",
      OperatingSystem: "linux",
      Architecture: "aarch64",
      Containers: 1,
      ContainersRunning: 1,
      ContainersStopped: 0,
      Images: 2,
      MemTotal: 8589934592,
    },
  );
  const probe = await client.probe();
  assert.equal(probe.capabilities.buildkit, true);
  assert.equal(probe.summary.apiVersion, "1.41");
  assert.equal(probe.summary.version, "20.10.24");

  const legacy = stubbedProbe(
    {},
    {
      ID: "old",
      ServerVersion: "17.06",
      ApiVersion: "1.38",
      Containers: 0,
      ContainersRunning: 0,
      ContainersStopped: 0,
      Images: 0,
      MemTotal: 0,
    },
  );
  const legacyProbe = await legacy.client.probe();
  assert.equal(legacyProbe.capabilities.buildkit, false);
  assert.equal(legacyProbe.summary.version, "17.06");
  assert.equal(legacyProbe.summary.minApiVersion, undefined);
});
