#!/usr/bin/env node
// Renderer click-through smoke for the Containers Prune dialog.
//
// Boots the real Electron main process in engine mode (the in-process
// Gateway wrapper + live Docker Engine), seeds one throwaway stopped
// container, drives the built renderer over CDP, opens the Prune
// dialog, confirms, and asserts the success toast plus Engine-side
// deletion. Only the container it creates is affected.
//
// Requires Docker (Docker Desktop named pipe by default; override with
// SMOKE_ENDPOINT) and a built renderer (pnpm --filter @harbor/desktop
// build:renderer).

import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoDir = resolve(fileURLToPath(import.meta.url), "../..");
const desktopDir = join(repoDir, "apps/desktop");
const electronBin = join(desktopDir, "node_modules/electron/dist/electron.exe");
const endpoint = process.env.SMOKE_ENDPOINT ?? "npipe:////./pipe/docker_engine";
const tag = "harbor-desk-click-" + Date.now().toString(36);
const containerName = tag + "-c";

const { DockerEngineClient } = await import(
  pathToFileURL(join(repoDir, "packages/connectors/dist/index.js")).href
);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(
    (ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  (" + detail + ")" : ""),
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startStaticServer() {
  const root = join(desktopDir, "dist/renderer");
  const types = {
    html: "text/html",
    js: "text/javascript",
    css: "text/css",
    svg: "image/svg+xml",
    png: "image/png",
    ico: "image/x-icon",
    woff2: "font/woff2",
    woff: "font/woff",
    map: "application/json",
  };
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent((req.url ?? "/").split("?")[0]);
      if (path === "/") path = "/index.html";
      const file = resolve(root, "." + path);
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const body = await readFile(file);
      const ext = path.split(".").pop() ?? "";
      res.writeHead(200, {
        "content-type": types[ext] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolveServer) =>
    server.listen(5173, "127.0.0.1", resolveServer),
  );
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message));
        else entry.resolve(message.result ?? {});
      }
    });
  }
  send(method, params) {
    const id = this.nextId++;
    return new Promise((resolveP, reject) => {
      this.pending.set(id, { resolve: resolveP, reject });
      this.ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }
}

async function fetchJson(url, timeoutMs = 30000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  return response.json();
}

function pageWsUrl(json) {
  for (const entry of json ?? []) {
    if (entry.webSocketDebuggerUrl && entry.type === "page")
      return entry.webSocketDebuggerUrl;
  }
  return undefined;
}

async function connectCdp() {
  for (let i = 0; i < 90; i += 1) {
    const json = await fetchJson("http://127.0.0.1:9222/json").catch(() => []);
    const wsUrl = pageWsUrl(json);
    if (wsUrl) {
      const ws = new WebSocket(wsUrl);
      await new Promise((resolveP, reject) => {
        ws.addEventListener("open", () => resolveP());
        ws.addEventListener("error", () =>
          reject(new Error("CDP websocket open failed")),
        );
      });
      const cdp = new Cdp(ws);
      await cdp.send("Runtime.enable");
      await cdp.send("Page.enable");
      return cdp;
    }
    await sleep(500);
  }
  throw new Error("no CDP page target found");
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails)
    throw new Error(
      "eval exception: " +
        JSON.stringify(
          result.exceptionDetails.exception?.description ??
            result.exceptionDetails,
        ),
    );
  return result.result?.value;
}

async function waitUntil(cdp, fn, label, timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await fn()) return;
    await sleep(300);
  }
  throw new Error("timed out waiting for " + label);
}

const R_FIND_BUTTON = `(() => {
  const buttons = Array.from(document.querySelectorAll("button"));
  return buttons.filter((b) => (b.textContent || "").trim() === "Prune")
    .length;
})()`;
const R_CLICK_PRUNE = `(() => {
  const buttons = Array.from(document.querySelectorAll("button"));
  const btn = buttons.find(
    (b) => (b.textContent || "").trim() === "Prune" && !b.disabled,
  );
  if (!btn) return "not-found";
  btn.click();
  return "clicked";
})()`;
const R_DIALOG_TEXT = `(() => {
  const dialog = document.querySelector('[role="dialog"]');
  return dialog ? (dialog.textContent || "").slice(0, 400) : "";
})()`;
const R_CLICK_DIALOG_PRUNE = `(() => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return "no-dialog";
  const buttons = Array.from(dialog.querySelectorAll("button"));
  const btn = buttons.find(
    (b) => (b.textContent || "").trim() === "Prune" && !b.disabled,
  );
  if (!btn) return "not-found";
  btn.click();
  return "clicked";
})()`;
const R_TOAST_TEXT = `(() => {
  const region = document.querySelector('[role="alert"]');
  return region ? region.textContent || "" : "";
})()`;

const userDataDir = await mkdtemp(join(tmpdir(), "harbor-click-"));
let electronProc;
let staticServer;
let client;
let cdp;

async function teardown() {
  try {
    electronProc?.kill();
  } catch {
    /* already gone */
  }
  try {
    staticServer?.close();
  } catch {
    /* already closed */
  }
  try {
    await client?.deleteContainer(containerName, true);
  } catch {
    /* best effort */
  }
  try {
    await rm(userDataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    cdp?.ws.close();
  } catch {
    /* ignore */
  }
}

try {
  client = new DockerEngineClient({ endpoint });
  await client.createContainer({
    image: "alpine:3.20",
    name: containerName,
    command: "true",
    restartPolicy: "no",
  });
  const seeded = (await client.listContainers(true)).some(
    (row) => row.name === containerName,
  );
  check("seeded one stopped container", seeded, containerName);

  staticServer = await startStaticServer();
  electronProc = spawn(
    electronBin,
    [
      desktopDir,
      "--remote-debugging-port=9222",
      "--user-data-dir=" + userDataDir,
    ],
    {
      stdio: ["ignore", "ignore", "ignore"],
      cwd: desktopDir,
      env: { ...process.env, VITE_GATEWAY_URL: endpoint },
    },
  );

  cdp = await connectCdp();
  console.log("info  CDP attached");

  await waitUntil(
    cdp,
    () =>
      evaluate(
        cdp,
        "window.harbor?.connection?.getStatus?.().then((s) => s.mode === 'engine' || s.mode === 'gateway').catch(() => false)",
      ),
    "engine connection mode",
  );
  check("renderer connected (engine/gateway mode)", true);

  await waitUntil(
    cdp,
    () => evaluate(cdp, R_FIND_BUTTON).then((count) => count >= 1),
    "header Prune button",
  );
  check("header Prune button rendered", true);

  const opened = await evaluate(cdp, R_CLICK_PRUNE);
  check("opened the Prune confirm dialog", opened === "clicked", opened);
  await waitUntil(
    cdp,
    () =>
      evaluate(cdp, R_DIALOG_TEXT).then((t) =>
        t.includes("Prune stopped containers?"),
      ),
    "dialog copy",
  );
  check("dialog shows the stopped-container warning", true);

  const confirmed = await evaluate(cdp, R_CLICK_DIALOG_PRUNE);
  check(
    "confirmed the prune from the dialog",
    confirmed === "clicked",
    confirmed,
  );

  await waitUntil(
    cdp,
    () => evaluate(cdp, R_TOAST_TEXT).then((t) => t.includes("pruned")),
    "success toast",
  );
  check("success toast shown", true, await evaluate(cdp, R_TOAST_TEXT));

  await sleep(500);
  const gone = !(await client.listContainers(true)).some(
    (row) => row.name === containerName,
  );
  check("Engine confirms the container was pruned", gone, containerName);
} catch (error) {
  check(
    "harness error",
    false,
    error instanceof Error ? error.message : String(error),
  );
} finally {
  await teardown();
}

const failed = results.filter((item) => !item.ok).length;
console.log("");
console.log(
  failed === 0
    ? "CLICK SMOKE PASS (" + results.length + " checks)"
    : "CLICK SMOKE FAIL (" + failed + " of " + results.length + " checks)",
);
process.exit(failed === 0 ? 0 : 1);
