const durationMs = Number(process.env.SOAK_DURATION_MS ?? 8 * 60 * 60 * 1000);
const intervalMs = Number(process.env.SOAK_INTERVAL_MS ?? 30_000);
const gatewayUrl = (
  process.env.SOAK_GATEWAY_URL ?? "http://127.0.0.1:4310"
).replace(/\/$/, "");
const rendererUrl = (
  process.env.SOAK_RENDERER_URL ?? "http://127.0.0.1:5173"
).replace(/\/$/, "");

const desktopPid = parseOptionalPid(
  process.env.SOAK_DESKTOP_PID,
  "SOAK_DESKTOP_PID",
);
const additionalProcessPids = parseProcessPids(process.env.SOAK_PROCESS_PIDS);
const watchedProcesses = [
  ...(desktopPid ? [{ name: "desktop", pid: desktopPid }] : []),
  ...additionalProcessPids
    .filter((pid) => pid !== desktopPid)
    .map((pid) => ({ name: "process:" + pid, pid })),
];

if (!Number.isFinite(durationMs) || durationMs <= 0)
  throw new Error("SOAK_DURATION_MS must be a positive number.");
if (!Number.isFinite(intervalMs) || intervalMs <= 0)
  throw new Error("SOAK_INTERVAL_MS must be a positive number.");

function parseOptionalPid(value, variableName) {
  if (!value) return undefined;
  const pid = Number(value);
  if (!Number.isInteger(pid) || pid <= 0)
    throw new Error(variableName + " must be a positive process ID.");
  return pid;
}

function parseProcessPids(value) {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .filter(Boolean)
        .map((pid) => parseOptionalPid(pid.trim(), "SOAK_PROCESS_PIDS")),
    ),
  ];
}

const startedAt = Date.now();
let checks = 0;
let failures = 0;
let inFlight = false;
let finishing = false;

async function checkEndpoint(name, url) {
  const started = performance.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return {
      name,
      ok: response.ok,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - started),
    };
  }
}

function checkProcess(name, pid) {
  try {
    process.kill(pid, 0);
    return { name, ok: true, pid };
  } catch (error) {
    return {
      name,
      ok: false,
      pid,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function check() {
  if (inFlight) return;
  inFlight = true;
  checks += 1;
  const results = await Promise.all([
    checkEndpoint("gateway", `${gatewayUrl}/health/live`),
    checkEndpoint("renderer", `${rendererUrl}/`),
  ]);
  const resultsWithProcesses = [
    ...results,
    ...watchedProcesses.map((processInfo) =>
      checkProcess(processInfo.name, processInfo.pid),
    ),
  ];
  const ok = resultsWithProcesses.every((result) => result.ok);
  if (!ok) failures += 1;
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      check: checks,
      ok,
      failures,
      results: resultsWithProcesses,
    }),
  );
  inFlight = false;
}

await check();
const timer = setInterval(() => void check(), intervalMs);
const finish = () => {
  if (finishing) return;
  finishing = true;
  clearInterval(timer);
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      checks,
      failures,
      completed: true,
      watchedProcesses,
    }),
  );
  process.exitCode = failures ? 1 : 0;
};

const timeout = setTimeout(finish, durationMs);
timeout.unref();
process.once("SIGINT", finish);
process.once("SIGTERM", finish);
