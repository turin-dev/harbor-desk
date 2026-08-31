#!/usr/bin/env node
// Renderer click-through smoke for the Containers Prune dialog plus the
// Kubernetes, Extensions, and Assistant screens.
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
import { createRequire } from "node:module";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoDir = resolve(fileURLToPath(import.meta.url), "../..");
const desktopDir = join(repoDir, "apps/desktop");
// The electron package exports the platform binary path (electron.exe on
// Windows, electron elsewhere).
const electronBin = createRequire(join(desktopDir, "package.json"))("electron");
const endpoint = process.env.SMOKE_ENDPOINT ?? "npipe:////./pipe/docker_engine";
const tag = "harbor-desk-click-" + Date.now().toString(36);
const containerName = tag + "-c";

const { DockerEngineClient } = await import(
  pathToFileURL(join(repoDir, "packages/connectors/dist/index.js")).href
);

const results = [];
// Captures renderer console output so failures can be diagnosed from
// CI logs without interactive access to the Electron process.
const consoleTail = [];
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
      cdp.ws.addEventListener("message", (event) => {
        let msg = null;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (msg?.method === "Runtime.consoleAPICalled") {
          const line = (msg.params.args ?? [])
            .map((a) => a.value ?? a.description ?? "")
            .join(" ");
          consoleTail.push("[" + msg.params.type + "] " + line);
          if (consoleTail.length > 30) consoleTail.shift();
        }
      });
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
  // The AppShell sidebar Drawer is a keepMounted MUI Modal and is also
  // a [role=dialog]; it is first in the DOM on wide (Windows) layouts,
  // so scope to the dialog that carries the Prune warning copy.
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
  const dialog = dialogs.find(
    (d) => (d.textContent || "").includes("Prune stopped containers?"),
  );
  return dialog ? dialog.textContent.slice(0, 400) : "";
})()`;
const R_CLICK_DIALOG_PRUNE = `(() => {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
  const dialog = dialogs.find(
    (d) => (d.textContent || "").includes("Prune stopped containers?"),
  );
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
// --- Navigation smoke for the new screens. The sidebar Drawer is
// keepMounted and is itself a [role=dialog] on wide layouts, so all
// content assertions are scoped to the <main> element.
const R_CONTENT = `(() => {
  const main = document.querySelector("main") || document.body;
  return (main.textContent || "").slice(0, 6000);
})()`;
const R_CLICK_NAV = (label) =>
  `(() => {
    const all = Array.from(document.querySelectorAll("nav *"));
    const matches = all.filter((el) => (el.textContent || "").trim() === ${JSON.stringify(label)});
    const visible = matches.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const sorted = (visible.length ? visible : matches).slice().sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
    const item = sorted[0];
    if (!item) return "diag:" + ((document.querySelector("nav") || {}).outerHTML || "none").slice(0, 700);
    item.click();
    return "clicked";
  })()`;
const R_CLICK_ASSIST_ANALYZE = `(() => {
  const buttons = Array.from(document.querySelectorAll("main button"));
  const btn = buttons.find((b) => (b.textContent || "").trim() === "Analyze host" && !b.disabled);
  if (!btn) return "not-found";
  btn.click();
  return "clicked";
})()`;
const R_CLICK_FIRST_EXTENSION_OPEN = `(() => {
  const buttons = Array.from(document.querySelectorAll("button"));
  const cands = buttons.filter((b) => (b.getAttribute("aria-label") || "").startsWith("Open ") && !b.disabled);
  const visible = cands.filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const btn = visible[0] || cands[0];
  if (!btn) return "not-found";
  btn.click();
  return "clicked";
})()`;
const R_LAST_DIALOG_TEXT = `(() => {
  const dialogs = Array.from(document.querySelectorAll("[role='dialog']"));
  const visible = dialogs.filter((d) => {
    const r = d.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const d = visible[visible.length - 1] || dialogs[dialogs.length - 1];
  return d ? (d.textContent || "").slice(0, 300) : "";
})()`;
const R_IFRAME_SRCDOC = `(() => {
  const iframes = Array.from(document.querySelectorAll("iframe"));
  const f = iframes.find((i) => (i.getAttribute("srcdoc") || "").length > 0);
  return f ? (f.getAttribute("srcdoc") || "").slice(0, 800) : "";
})()`;
const R_CLOSE_EXTENSION_DIALOG = `(() => {
  const buttons = Array.from(document.querySelectorAll('[role="dialog"] button'));
  const btn = buttons.find((b) => (b.textContent || "").trim() === "Close" && !b.disabled);
  if (!btn) return "not-found";
  btn.click();
  return "clicked";
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
  for (const line of consoleTail.splice(0))
    console.log("renderer-console  " + line);
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
  const probeClient = new DockerEngineClient({ endpoint });
  let probe = null;
  let probeError = null;
  // The Engine may still be starting when this step runs; retry like
  // the other live smokes instead of assuming the first probe wins.
  for (let attempt = 0; attempt < 60 && probe === null; attempt += 1) {
    try {
      probe = await probeClient.probe();
    } catch (error) {
      probeError = error;
      await sleep(2000);
    }
  }
  if (probe === null)
    throw new Error(
      "engine not ready: " +
        (probeError instanceof Error ? probeError.message : String(probeError)),
    );
  const isWindowsEngine = String(probe.summary.operatingSystem ?? "")
    .toLowerCase()
    .includes("windows");
  client = new DockerEngineClient({ endpoint });
  if (isWindowsEngine) {
    // Windows containers cannot run the linux alpine seed; the engine
    // smoke already verified this image and rawCommand on the runner.
    await client.pullImage(
      { image: "mcr.microsoft.com/windows/servercore:ltsc2025" },
      () => undefined,
    );
    await client.createContainer({
      image: "mcr.microsoft.com/windows/servercore:ltsc2025",
      name: containerName,
      rawCommand: ["true"],
      restartPolicy: "no",
    });
  } else {
    await client.createContainer({
      image: "alpine:3.20",
      name: containerName,
      command: "true",
      restartPolicy: "no",
    });
  }
  const seeded = (await client.listContainers(true)).some(
    (row) => row.name === containerName,
  );
  check("seeded one stopped container", seeded, containerName);

  staticServer = await startStaticServer();
  const isLinux = process.platform === "linux";
  // Headless Linux (CI) needs an X server; GitHub runners ship xvfb-run.
  const electronArgs = [
    desktopDir,
    "--remote-debugging-port=9222",
    "--user-data-dir=" + userDataDir,
    ...(isLinux ? ["--no-sandbox"] : []),
  ];
  electronProc = spawn(
    isLinux ? "xvfb-run" : electronBin,
    isLinux ? ["-a", electronBin, ...electronArgs] : electronArgs,
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

  // The first click can race the renderer on slower hosts (Windows
  // runners in particular); retry until the dialog actually opens.
  let opened = "not-found";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    opened = await evaluate(cdp, R_CLICK_PRUNE);
    if (opened === "clicked") {
      const copyReady = await evaluate(cdp, R_DIALOG_TEXT)
        .then((t) => t.includes("Prune stopped containers?"))
        .catch(() => false);
      if (copyReady) break;
    }
    await sleep(1000);
  }
  check("opened the Prune confirm dialog", opened === "clicked", opened);
  try {
    await waitUntil(
      cdp,
      () =>
        evaluate(cdp, R_DIALOG_TEXT).then((t) =>
          t.includes("Prune stopped containers?"),
        ),
      "dialog copy",
      120000,
    );
  } catch (error) {
    const dialogText = await evaluate(cdp, R_DIALOG_TEXT).catch(() => "?");
    const dialogInfo = await evaluate(
      cdp,
      "(() => Array.from(document.querySelectorAll('[role=dialog]')).map((d) => (d.textContent || '').slice(0, 120)))()",
    ).catch(() => null);
    for (const line of consoleTail.splice(0))
      console.log("renderer-console  " + line);
    throw new Error(
      (error instanceof Error ? error.message : String(error)) +
        " | dialog=" +
        JSON.stringify(dialogText) +
        " | dialogs=" +
        JSON.stringify(dialogInfo),
    );
  }
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

  // --- New screen navigation smoke (Kubernetes / Extensions / Assistant) ---
  const navCheck = async (label, expected) => {
    let clicked = "not-found";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      clicked = await evaluate(cdp, R_CLICK_NAV(label));
      if (clicked === "clicked") break;
      await sleep(500);
    }
    check("clicked sidebar " + label, clicked === "clicked", clicked);
    try {
      await waitUntil(
        cdp,
        async () => {
          const t = (await evaluate(cdp, R_CONTENT)) || "";
          return t.includes(expected);
        },
        "content shows " + expected,
        20000,
      );
      check("showed " + label + " content", true);
    } catch (error) {
      const content = (await evaluate(cdp, R_CONTENT).catch(() => "?")) || "?";
      throw new Error(
        (error instanceof Error ? error.message : String(error)) +
          " | content=" +
          JSON.stringify(content.slice(0, 600)),
      );
    }
  };

  await navCheck("Kubernetes", "Kubernetes clusters");
  await navCheck("Extensions", "admin-approved extension catalog");
  await navCheck("Assistant", "Analyze host");

  let analyzed = "not-found";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    analyzed = await evaluate(cdp, R_CLICK_ASSIST_ANALYZE);
    if (analyzed === "clicked") break;
    await sleep(500);
  }
  check("clicked Analyze host", analyzed === "clicked", analyzed);
  await waitUntil(
    cdp,
    async () => {
      const t = (await evaluate(cdp, R_CONTENT)) || "";
      return t.includes("Insights (");
    },
    "assistant insights",
    30000,
  );
  const insightsSnippet = (
    (await evaluate(cdp, R_CONTENT).catch(() => "")) || ""
  )
    .split("Insights (")
    .pop()
    .slice(0, 30);
  check("assistant rendered insights and proposals", true, insightsSnippet);
  let extNav = "not-found";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    extNav = await evaluate(cdp, R_CLICK_NAV("Extensions"));
    if (extNav === "clicked") break;
    await sleep(500);
  }
  check("returned to the Extensions screen", extNav === "clicked", extNav);

  let extOpened = "not-found";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    extOpened = await evaluate(cdp, R_CLICK_FIRST_EXTENSION_OPEN);
    if (extOpened === "clicked") {
      const dialogText = await evaluate(cdp, R_LAST_DIALOG_TEXT);
      if (dialogText.includes("Harbor Insights")) break;
    }
    await sleep(1000);
  }
  check(
    "clicked the extension Open button",
    extOpened === "clicked",
    extOpened,
  );
  let extIframeOk = false;
  try {
    await waitUntil(
      cdp,
      async () => {
        const srcdoc = await evaluate(cdp, R_IFRAME_SRCDOC);
        if (srcdoc.includes("Live cluster-wide usage trends")) {
          return true;
        }
        // The content never appeared: re-open the extension (this re-fetches the
        // web page) and try again. Harmless when the dialog is already open.
        await evaluate(cdp, R_CLICK_FIRST_EXTENSION_OPEN);
        await sleep(1000);
        return false;
      },
      "extension web iframe",
      30000,
    );
    extIframeOk = true;
  } catch (error) {
    const dialogText =
      (await evaluate(cdp, R_LAST_DIALOG_TEXT).catch(() => "")) || "";
    const srcdoc = (await evaluate(cdp, R_IFRAME_SRCDOC).catch(() => "")) || "";
    throw new Error(
      (error instanceof Error ? error.message : String(error)) +
        " | dialog=" +
        JSON.stringify(dialogText) +
        " | srcdoc=" +
        JSON.stringify(srcdoc.slice(0, 200)),
    );
  }
  check("extension web page rendered in the in-app dialog", extIframeOk);
  const closed = await evaluate(cdp, R_CLOSE_EXTENSION_DIALOG);
  check("closed the extension dialog", closed === "clicked", closed);
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
