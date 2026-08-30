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
let browseWriterId = null;

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
  if (browseWriterId) {
    await client.deleteContainer(browseWriterId, true).catch(() => undefined);
    browseWriterId = null;
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
  // A freshly provisioned runner's Engine can still be starting when the
  // smoke begins, so wait for the endpoint before counting the probe as a
  // real check.
  let ready = false;
  let lastProbeError;
  for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
    try {
      await client.probe();
      ready = true;
    } catch (error) {
      lastProbeError = error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  if (!ready) {
    check(
      "probe",
      false,
      "engine not ready: " +
        (lastProbeError instanceof Error
          ? lastProbeError.message
          : String(lastProbeError)),
    );
    process.exit(1);
  }

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
  // The Engine reports the full host OS description, for example
  // 'Microsoft Windows Server Version 24H2' on native Windows CI and
  // 'Ubuntu 24.04.2 LTS' on Linux, so detect Windows anywhere in the
  // string instead of at the start.
  const isWindowsEngine = String(probe.summary.operatingSystem ?? "")
    .toLowerCase()
    .includes("windows");
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

  // A large pull can leave the Engine still unpacking layers; the
  // createNetwork check below would otherwise time out right after a
  // fresh multi-GB pull. Warm up the request path first.
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      await client.listNetworks();
      break;
    } catch (error) {
      if (attempt === 14) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  check("engine responsive after image pull", true);

  await client.createVolume({ name: volumeName });
  createdVolume = true;
  const volumes = await client.listVolumes();
  check(
    "volume create+list",
    volumes.some((item) => item.name === volumeName),
    volumeName,
  );

  // Write marker files through a mounted container, then verify the
  // read-only volume browser can list and navigate into them.
  const writerTarget = isWindowsEngine ? "C:\\volume" : "/volume";
  const writerCommand = isWindowsEngine
    ? {
        rawCommand: [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "New-Item -ItemType Directory -Force -Path 'C:\\volume\\sub' | Out-Null; Set-Content -Path 'C:\\volume\\harbor-browse.txt' -Value 'harbor'; Set-Content -Path 'C:\\volume\\sub\\b.txt' -Value 'sub'",
        ],
      }
    : {
        rawCommand: [
          "/bin/sh",
          "-c",
          "mkdir -p /volume/sub && echo harbor > /volume/harbor-browse.txt && echo sub > /volume/sub/b.txt",
        ],
      };
  browseWriterId = await client.createContainer({
    image: baseImage,
    restartPolicy: "no",
    ...writerCommand,
    volumeMounts: [{ source: volumeName, target: writerTarget }],
  });
  await client.actionContainer(browseWriterId, "start");
  let writerDone = false;
  for (let attempt = 0; attempt < 50 && !writerDone; attempt += 1) {
    const row = (await client.listContainers(true)).find(
      (item) => item.id === browseWriterId,
    );
    writerDone = row?.state === "exited" || row?.state === "dead";
    if (!writerDone) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  check("volume marker container finished", writerDone);
  await client.deleteContainer(browseWriterId, true);
  browseWriterId = null;

  // nanoserver fallback images ship no PowerShell, so the Windows browser
  // path is only exercised when the engine base image supports it.
  const browseSupported = !isWindowsEngine || baseImage.includes("servercore");
  if (browseSupported) {
    const browseRoot = await client.browseVolume({
      volume: volumeName,
      path: "/",
      image: baseImage,
    });
    const rootNames = browseRoot.entries.map((entry) => entry.name);
    check(
      "volume browse lists the marker files",
      rootNames.includes("harbor-browse.txt") && rootNames.includes("sub"),
      "entries=" + rootNames.join(","),
    );
    const browseSub = await client.browseVolume({
      volume: volumeName,
      path: "/sub",
      image: baseImage,
    });
    const subNames = browseSub.entries.map((entry) => entry.name);
    check(
      "volume browse navigates into a subfolder",
      subNames.includes("b.txt"),
      "entries=" + subNames.join(","),
    );
  } else {
    check(
      "volume browse skipped for this engine image",
      true,
      "skipped: " + baseImage,
    );
  }

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
