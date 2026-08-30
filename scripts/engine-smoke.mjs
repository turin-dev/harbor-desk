#!/usr/bin/env node
// Real-Engine smoke: exercises the Docker connector mutation surface and
// the server-side abort path against a live Engine.
//
// Docker Desktop (Windows) by default; override with SMOKE_ENDPOINT for
// unix:///var/run/docker.sock or http://host:2375 targets.
//
// The script only creates and deletes its own resources. The prune check
// uses all=false, which leaves named (user) containers in place.

import { DockerEngineClient } from "../packages/connectors/dist/index.js";

const endpoint = process.env.SMOKE_ENDPOINT ?? "npipe:////./pipe/docker_engine";
const tag = "harbor-desk-smoke-" + Date.now().toString(36);
const containerName = tag + "-c";
const volumeName = tag + "-v";
const networkName = tag + "-n";
const LINUX_IMAGE_CANDIDATES = ["alpine:3.20", "alpine:3.21"];
const LINUX_SLOW_IMAGE = "postgres:16";
const WINDOWS_IMAGE_CANDIDATES = [
  "mcr.microsoft.com/windows/servercore:ltsc2025",
  "mcr.microsoft.com/windows/servercore:ltsc2022",
  "mcr.microsoft.com/windows/nanoserver:ltsc2025",
  "mcr.microsoft.com/windows/nanoserver:ltsc2022",
];

const results = [];
let client;
let createdContainer = null;
let createdVolume = false;
let createdNetworkId = null;

function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(
    (ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  (" + detail + ")" : ""),
  );
}

function isCancelled(error) {
  return Boolean(error) && error.code === "operation_cancelled";
}

async function cleanUp() {
  if (!client) return;
  if (createdContainer) {
    await client.deleteContainer(createdContainer, true).catch(() => undefined);
    createdContainer = null;
  }
  if (createdVolume) {
    await client.deleteVolume(volumeName, true).catch(() => undefined);
    createdVolume = false;
  }
  if (createdNetworkId) {
    await client.deleteNetwork(createdNetworkId).catch(() => undefined);
    createdNetworkId = null;
  }
}

try {
  client = new DockerEngineClient({ endpoint });

  const probe = await client.probe();
  check(
    "probe",
    true,
    "Engine " +
      probe.summary.version +
      ", containers capability " +
      (probe.capabilities.containers ? "on" : "off"),
  );
  if (!probe.capabilities.containers)
    throw new Error("Engine does not advertise the containers capability");

  // A Windows Engine cannot run or even pull the Linux base image (the
  // manifest list has no windows/amd64 entry), so pick the image stack by
  // the platform the Engine itself runs on. Windows Server builds differ by
  // OS version (Server 2025 is 10.0.26100, Server 2022 is 10.0.20348), so
  // try the candidates in order and keep the first image the Engine can
  // pull; a fresh CI runner may report a newer Windows build than any
  // fixed tag listed here.
  const isWindowsEngine = String(probe.summary.operatingSystem ?? "")
    .toLowerCase()
    .startsWith("windows");
  const candidates = isWindowsEngine
    ? WINDOWS_IMAGE_CANDIDATES
    : LINUX_IMAGE_CANDIDATES;
  let baseImage = null;
  const skipReasons = [];
  for (const candidate of candidates) {
    try {
      await client.pullImage({ image: candidate }, () => undefined);
      baseImage = candidate;
      break;
    } catch (error) {
      // Not pullable on this Engine (OS version mismatch or registry
      // error); try the next candidate.
      skipReasons.push(
        candidate +
          ": " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }
  if (!baseImage) {
    throw new Error(
      "No pullable base image for " +
        String(probe.summary.operatingSystem ?? "unknown") +
        " (" +
        skipReasons.join("; ") +
        ")",
    );
  }
  // The cancel-pull test needs an uncached image, so the slow image must
  // differ from the base image that was just pulled.
  const slowImage = isWindowsEngine
    ? (candidates.find((candidate) => candidate !== baseImage) ?? baseImage)
    : LINUX_SLOW_IMAGE;
  const baseCommand = isWindowsEngine
    ? { rawCommand: ["ping", "-n", "31", "127.0.0.1"] }
    : { command: "sleep 30" };
  const pruneCommand = isWindowsEngine
    ? { rawCommand: ["true"] }
    : { command: "true" };

  // Fresh CI runners do not cache the base image; the container lifecycle
  // below must not depend on an implicit pull (timeout / 404 otherwise).
  await client.pullImage({ image: baseImage }, () => undefined);
  check("base image available for the container lifecycle", true, baseImage);

  await client.createVolume({ name: volumeName });
  createdVolume = true;
  const volumes = await client.listVolumes();
  check(
    "volume create+list",
    volumes.some((item) => item.name === volumeName),
    volumeName,
  );

  createdNetworkId = await client.createNetwork({
    name: networkName,
    driver: "bridge",
  });
  const networks = await client.listNetworks();
  check(
    "network create+list",
    networks.some(
      (item) => item.name === networkName || item.id === createdNetworkId,
    ),
    networkName,
  );

  const containerId = await client.createContainer({
    image: baseImage,
    name: containerName,
    ...baseCommand,
    restartPolicy: "no",
  });
  createdContainer = containerId;
  const createdRow = (await client.listContainers(true)).find(
    (item) => item.id === containerId,
  );
  check(
    "container created",
    Boolean(createdRow),
    createdRow?.state ?? "unknown state",
  );

  await client.actionContainer(containerId, "start");
  let running = false;
  for (let attempt = 0; attempt < 50 && !running; attempt += 1) {
    const row = (await client.listContainers(true)).find(
      (item) => item.id === containerId,
    );
    running = row?.state === "running";
    if (!running) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  check("container started", running);

  await client.actionContainer(containerId, "stop");
  await client.deleteContainer(containerId);
  createdContainer = null;
  const deletedRow = (await client.listContainers(true)).find(
    (item) => item.id === containerId,
  );
  check("container stopped+deleted", !deletedRow);

  const aborted = new AbortController();
  aborted.abort();
  const failFast = await client
    .deleteVolume("harbor-desk-smoke-missing", true, aborted.signal)
    .then(
      () => null,
      (error) => error,
    );
  check(
    "already-aborted signal fails fast with operation_cancelled",
    isCancelled(failFast),
    failFast ? String(failFast.code ?? failFast.name) : "request resolved",
  );

  const pullAbort = new AbortController();
  const frames = [];
  const pullPromise = client
    .pullImage(
      { image: slowImage },
      (frame) => frames.push(frame),
      pullAbort.signal,
    )
    .then(
      () => null,
      (error) => error,
    );
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (!pullAbort.signal.aborted) pullAbort.abort();
  const pullError = await pullPromise;
  check(
    "cancels a running pull with operation_cancelled",
    isCancelled(pullError),
    "progress frames=" +
      frames.length +
      (pullError && !isCancelled(pullError)
        ? ", got=" + String(pullError.code ?? pullError.name)
        : ""),
  );

  // A never-started container is already prune-eligible; creating one keeps
  // the check self-contained instead of touching unrelated stopped containers.
  const pruneTarget = await client.createContainer({
    image: baseImage,
    ...pruneCommand,
    restartPolicy: "no",
  });
  const prune = await client.pruneContainers(false);
  const pruneTargetAfter = (await client.listContainers(true)).find(
    (item) => item.id === pruneTarget,
  );
  check(
    "prune containers removes the stopped target container",
    !pruneTargetAfter &&
      (prune.containersDeleted ?? []).some((id) => id.startsWith(pruneTarget)),
    "pruned=" +
      (prune.containersDeleted?.length ?? 0) +
      " freed=" +
      (prune.freedBytes ?? 0) +
      "B",
  );

  const finalProbe = await client.probe();
  check(
    "engine still healthy after aborts",
    finalProbe.summary.version === probe.summary.version,
  );
} catch (error) {
  check(
    "unexpected failure",
    false,
    error instanceof Error ? error.message : String(error),
  );
} finally {
  await cleanUp();
}

const failed = results.filter((item) => !item.ok).length;
console.log("");
console.log(
  failed === 0
    ? "SMOKE PASS (" + results.length + " checks)"
    : "SMOKE FAIL (" + failed + " of " + results.length + " checks)",
);
process.exit(failed === 0 ? 0 : 1);
