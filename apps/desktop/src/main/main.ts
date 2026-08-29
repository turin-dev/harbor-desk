import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  shell,
  Tray,
} from "electron";
import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConnectionManager,
  parseStoredConnectionTarget,
  type ConnectionStatus,
  type ConnectionTargetInput,
} from "./connection-manager.js";
import {
  checkForUpdates,
  initialUpdateStatus,
  isTrustedUpdateReleaseUrl,
  type UpdateCheckStatus,
} from "./update-checker.js";

const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
const seedGatewayUrl = process.env.VITE_GATEWAY_URL?.trim() || undefined;
const currentDir = dirname(fileURLToPath(import.meta.url));
const devOrigin = new URL(devServerUrl).origin;
const devWebSocketOrigin = devOrigin.replace(/^http/i, "ws");
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let accessToken: string | undefined;
let isQuitting = false;
let gatewayShutdownStarted = false;
let connectionManager: ConnectionManager | undefined;
let updateStatus: UpdateCheckStatus | undefined;
let updateCheckInFlight: Promise<UpdateCheckStatus> | undefined;
let lastUpdateCheckStartedAt = 0;
let lastUpdateCheckIncludedPrereleases: boolean | undefined;
let connectionStatus: ConnectionStatus = {
  mode: "unconfigured",
  message: "No Gateway or Docker Engine connection is configured.",
  localGateway: false,
};
let pendingLogin:
  | { providerId: string; state: string; nonce: string; verifier: string }
  | undefined;

interface StoredRefreshToken {
  providerId: string;
  refreshToken: string;
}

const updateCheckCooldownMs = 15 * 60 * 1_000;

function currentUpdateStatus(): UpdateCheckStatus {
  updateStatus ??= initialUpdateStatus(app.getVersion());
  return updateStatus;
}

function notifyUpdateStatus(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("updates:status", { ...currentUpdateStatus() });
}

function setUpdateStatus(status: UpdateCheckStatus): UpdateCheckStatus {
  updateStatus = status;
  notifyUpdateStatus();
  return status;
}

async function runUpdateCheck(input?: {
  includePrerelease?: boolean;
  manual?: boolean;
}): Promise<UpdateCheckStatus> {
  const includePrerelease = input?.includePrerelease !== false;
  const now = Date.now();
  if (updateCheckInFlight) return updateCheckInFlight;
  if (
    input?.manual !== true &&
    lastUpdateCheckIncludedPrereleases === includePrerelease &&
    now - lastUpdateCheckStartedAt < updateCheckCooldownMs &&
    currentUpdateStatus().state !== "idle"
  )
    return currentUpdateStatus();

  lastUpdateCheckStartedAt = now;
  lastUpdateCheckIncludedPrereleases = includePrerelease;
  setUpdateStatus({
    state: "checking",
    currentVersion: app.getVersion(),
    message: "Checking GitHub Releases for updates…",
  });

  updateCheckInFlight = checkForUpdates({
    currentVersion: app.getVersion(),
    includePrerelease,
  })
    .then(setUpdateStatus)
    .catch(() =>
      setUpdateStatus({
        state: "error",
        currentVersion: app.getVersion(),
        checkedAt: new Date().toISOString(),
        message: "The update check failed unexpectedly. Try again later.",
      }),
    )
    .finally(() => {
      updateCheckInFlight = undefined;
    });
  return updateCheckInFlight;
}

function desktopGatewayHeaders(): Record<string, string> {
  const sessionToken = connectionManager?.getSessionToken();
  return sessionToken ? { "x-harbor-desktop-token": sessionToken } : {};
}

function activeGatewayUrl(): string | undefined {
  return connectionManager?.getGatewayUrl();
}

function requiredGatewayUrl(): string {
  const url = activeGatewayUrl();
  if (!url)
    throw new Error(
      "No active Harbor Desk Gateway is configured. Open Settings and configure a connection target.",
    );
  return url;
}

function connectionOrigins(): string[] {
  const url = activeGatewayUrl();
  if (!url) return [];
  try {
    const origin = new URL(url).origin;
    return [origin, origin.replace(/^http/i, "ws")];
  } catch {
    return [];
  }
}

function notifyConnectionChanged(status: ConnectionStatus): void {
  connectionStatus = status;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("connection:changed", status);
}

async function initializeConnection(): Promise<void> {
  const storedTarget = parseStoredConnectionTarget(
    await readSecureValue("connection-target"),
  );
  connectionManager = new ConnectionManager({
    gatewayVersion: app.getVersion(),
    seedEndpoint: seedGatewayUrl,
    initialTarget: storedTarget,
    onChanged: notifyConnectionChanged,
  });
  try {
    connectionStatus = await connectionManager.initialize();
  } catch (error) {
    connectionStatus = {
      mode: "unavailable",
      endpoint: seedGatewayUrl,
      message:
        error instanceof Error
          ? error.message
          : "The connection target could not be initialized.",
      localGateway: false,
    };
    console.error("[connection] initialization failed", {
      message: connectionStatus.message,
    });
  }
}

function secureTokenPath(key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(app.getPath("userData"), "secure", `${safeKey}.bin`);
}

function notifyAuthChanged(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("auth:changed");
}

async function writeSecureValue(key: string, value: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("OS secure storage is unavailable");
  const path = secureTokenPath(key);
  await mkdir(join(app.getPath("userData"), "secure"), { recursive: true });
  await writeFile(path, safeStorage.encryptString(value));
}

async function readSecureValue(key: string): Promise<string | undefined> {
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  const path = secureTokenPath(key);
  if (!existsSync(path)) return undefined;
  try {
    return safeStorage.decryptString(await readFile(path));
  } catch {
    return undefined;
  }
}

async function deleteSecureValue(key: string): Promise<void> {
  const path = secureTokenPath(key);
  if (existsSync(path)) await unlink(path);
}

async function clearStoredAuth(): Promise<void> {
  accessToken = undefined;
  pendingLogin = undefined;
  await deleteSecureValue("oidc-refresh");
  notifyAuthChanged();
}

function parseConnectionInput(value: unknown): ConnectionTargetInput {
  if (!value || typeof value !== "object")
    throw new Error("A connection target is required.");
  const input = value as Record<string, unknown>;
  const text = (key: string): string | undefined =>
    typeof input[key] === "string" ? input[key] : undefined;
  const endpoint = text("endpoint");
  if (!endpoint?.trim()) throw new Error("A connection URL is required.");
  return {
    endpoint,
    displayName: text("displayName"),
    ca: text("ca"),
    cert: text("cert"),
    key: text("key"),
  };
}

async function persistConnectionTarget(): Promise<void> {
  const target = connectionManager?.getPersistedTarget();
  if (!target) {
    await deleteSecureValue("connection-target");
    return;
  }
  await writeSecureValue("connection-target", JSON.stringify(target));
}

async function exchangeAuthToken(input: {
  providerId: string;
  code?: string;
  codeVerifier?: string;
  nonce?: string;
  refreshToken?: string;
}): Promise<{ accessToken: string; refreshToken?: string }> {
  const response = await fetch(`${requiredGatewayUrl()}/api/v1/auth/token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...desktopGatewayHeaders(),
    },
    body: JSON.stringify({
      ...input,
      redirectUri: "harbor-desk://auth/callback",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => undefined)) as
    | {
        data?: { accessToken?: unknown; refreshToken?: unknown };
        error?: { message?: string };
      }
    | undefined;
  if (!response.ok || typeof body?.data?.accessToken !== "string")
    throw new Error(
      body?.error?.message ?? "The identity provider token exchange failed.",
    );
  return {
    accessToken: body.data.accessToken,
    refreshToken:
      typeof body.data.refreshToken === "string"
        ? body.data.refreshToken
        : undefined,
  };
}

async function startLogin(providerId: string): Promise<boolean> {
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(providerId)) return false;
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const authorize = new URL(
    `/api/v1/auth/authorize/${encodeURIComponent(providerId)}`,
    requiredGatewayUrl(),
  );
  authorize.searchParams.set("redirectUri", "harbor-desk://auth/callback");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  authorize.searchParams.set("codeChallenge", codeChallenge);
  pendingLogin = { providerId, state, nonce, verifier };
  await shell.openExternal(authorize.toString());
  return true;
}

async function handleAuthCallback(rawUrl: string): Promise<void> {
  let callback: URL;
  try {
    callback = new URL(rawUrl);
  } catch {
    return;
  }
  if (
    callback.protocol !== "harbor-desk:" ||
    callback.hostname !== "auth" ||
    callback.pathname !== "/callback"
  )
    return;
  const pending = pendingLogin;
  pendingLogin = undefined;
  if (!pending || callback.searchParams.get("state") !== pending.state) {
    notifyAuthChanged();
    return;
  }
  const code = callback.searchParams.get("code");
  if (!code) {
    notifyAuthChanged();
    return;
  }
  try {
    const token = await exchangeAuthToken({
      providerId: pending.providerId,
      code,
      codeVerifier: pending.verifier,
      nonce: pending.nonce,
    });
    accessToken = token.accessToken;
    if (token.refreshToken)
      await writeSecureValue(
        "oidc-refresh",
        JSON.stringify({
          providerId: pending.providerId,
          refreshToken: token.refreshToken,
        } satisfies StoredRefreshToken),
      );
  } catch {
    accessToken = undefined;
  }
  notifyAuthChanged();
}

async function refreshStoredAuth(): Promise<boolean> {
  const stored = await readSecureValue("oidc-refresh");
  if (!stored) return false;
  try {
    const parsed = JSON.parse(stored) as Partial<StoredRefreshToken>;
    if (!parsed.providerId || !parsed.refreshToken) return false;
    const token = await exchangeAuthToken({
      providerId: parsed.providerId,
      refreshToken: parsed.refreshToken,
    });
    accessToken = token.accessToken;
    if (token.refreshToken)
      await writeSecureValue(
        "oidc-refresh",
        JSON.stringify({
          providerId: parsed.providerId,
          refreshToken: token.refreshToken,
        } satisfies StoredRefreshToken),
      );
    return true;
  } catch {
    accessToken = undefined;
    return false;
  }
}

async function restoreAuth(): Promise<void> {
  await refreshStoredAuth();
}

function attachRendererDiagnostics(window: BrowserWindow): void {
  const contents = window.webContents;

  contents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (isMainFrame)
        console.error("[renderer] load failed", {
          errorCode,
          errorDescription,
          validatedUrl,
        });
    },
  );
  contents.on("render-process-gone", (_event, details) => {
    console.error("[renderer] process gone", details);
  });
  contents.on("console-message", ({ level, message, lineNumber, sourceId }) => {
    if (level === "warning" || level === "error")
      console.error("[renderer] console message", {
        level,
        message,
        line: lineNumber,
        sourceId,
      });
  });
  contents.on("did-finish-load", () => {
    if (process.env.HARBOR_RENDERER_DIAGNOSTICS !== "1") return;
    const timer = setTimeout(() => {
      if (contents.isDestroyed()) return;
      void contents
        .executeJavaScript(
          "(() => { const root = document.getElementById('root'); const describe = (element) => { if (!element) return null; const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return { tag: element.tagName, text: element.textContent?.trim().slice(0, 80) ?? '', rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }, display: style.display, visibility: style.visibility, opacity: style.opacity, color: style.color, backgroundColor: style.backgroundColor }; }; const dashboard = Array.from(root?.querySelectorAll('*') ?? []).find((element) => element.textContent?.trim() === 'Dashboard'); return { url: location.href, readyState: document.readyState, rootChildren: root?.childElementCount ?? 0, rootTextLength: root?.textContent?.trim().length ?? 0, rootText: root?.textContent?.trim().slice(0, 160) ?? '', bodyBackground: getComputedStyle(document.body).backgroundColor, styleSheets: document.styleSheets.length, root: describe(root), dashboard: describe(dashboard) }; })()",
          true,
        )
        .then((snapshot) => console.info("[renderer] snapshot", snapshot))
        .catch((error) =>
          console.error("[renderer] snapshot failed", {
            message: error instanceof Error ? error.message : String(error),
          }),
        );

      const capturePath = process.env.HARBOR_RENDERER_CAPTURE_PATH;
      if (capturePath)
        void contents
          .capturePage()
          .then((image) => writeFile(capturePath, image.toPNG()))
          .then(() => console.info("[renderer] captured page", { capturePath }))
          .catch((error) =>
            console.error("[renderer] capture failed", {
              message: error instanceof Error ? error.message : String(error),
            }),
          );
    }, 500);
    timer.unref();
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0d1218",
    title: "Harbor Desk",
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(app.getAppPath(), "dist-electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  attachRendererDiagnostics(mainWindow);

  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      if (details.resourceType !== "mainFrame") {
        callback({
          responseHeaders: details.responseHeaders,
        });
        return;
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${[
              ...connectionOrigins(),
              ...(!app.isPackaged ? [devOrigin, devWebSocketOrigin] : []),
            ].join(" ")}; font-src 'self' data:;`,
          ],
        },
      });
    },
  );

  if (!app.isPackaged) {
    await mainWindow.loadURL(devServerUrl);
    if (process.env.OPEN_DEVTOOLS === "1")
      mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(
      join(currentDir, "../../dist/renderer/index.html"),
    );
  }

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function createTray(): void {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="7" fill="#2986ff"/>
    <path d="M12 10 8 16l4 6M20 10l4 6-4 6" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  tray = new Tray(
    nativeImage.createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    ),
  );
  const menu = Menu.buildFromTemplate([
    { label: "Open Harbor Desk", click: () => mainWindow?.show() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setToolTip("Harbor Desk");
  tray.setContextMenu(menu);
  tray.on("double-click", () => mainWindow?.show());
}

function registerIpc(): void {
  ipcMain.handle("app:window-control", (_event, action: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (action === "minimize") {
      mainWindow.minimize();
      return true;
    }
    if (action === "toggleMaximize") {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
      return true;
    }
    if (action === "close") {
      mainWindow.close();
      return true;
    }
    return false;
  });

  ipcMain.handle("app:set-launch-at-login", (_event, enabled: unknown) => {
    const openAtLogin = enabled === true;
    app.setLoginItemSettings({ openAtLogin, openAsHidden: true });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle(
    "app:select-file",
    async (_event, options?: { extensions?: string[] }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: options?.extensions?.length
          ? [{ name: "Allowed files", extensions: options.extensions }]
          : undefined,
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
  );

  ipcMain.handle("app:open-external", async (_event, url: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("updates:get-status", () => ({ ...currentUpdateStatus() }));
  ipcMain.handle("updates:check", async (_event, value: unknown) => {
    const input =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : undefined;
    return runUpdateCheck({
      includePrerelease: input?.includePrerelease !== false,
      manual: input?.manual === true,
    });
  });
  ipcMain.handle("updates:open-release", async () => {
    const status = currentUpdateStatus();
    if (
      status.state !== "available" ||
      !status.releaseUrl ||
      !isTrustedUpdateReleaseUrl(status.releaseUrl)
    )
      return false;
    await shell.openExternal(status.releaseUrl);
    return true;
  });

  ipcMain.handle("auth:start", async (_event, providerId: unknown) =>
    typeof providerId === "string" ? startLogin(providerId) : false,
  );
  ipcMain.handle("auth:get-access-token", () => accessToken);
  ipcMain.handle("auth:refresh", async () => {
    const refreshed = await refreshStoredAuth();
    if (refreshed) notifyAuthChanged();
    return refreshed;
  });
  ipcMain.handle("auth:logout", async () => {
    await clearStoredAuth();
    return true;
  });

  ipcMain.handle(
    "connection:get-status",
    () => connectionManager?.getStatus() ?? { ...connectionStatus },
  );
  ipcMain.handle("connection:get-session-token", () =>
    connectionManager?.getSessionToken(),
  );
  ipcMain.handle("connection:configure", async (_event, value: unknown) => {
    if (!connectionManager)
      throw new Error("The connection manager is unavailable.");
    const input = parseConnectionInput(value);
    try {
      const status = await connectionManager.configure(input);
      await persistConnectionTarget();
      await clearStoredAuth();
      mainWindow?.webContents.reload();
      return status;
    } catch (error) {
      await persistConnectionTarget().catch(() => undefined);
      await clearStoredAuth();
      mainWindow?.webContents.reload();
      throw error;
    }
  });
  ipcMain.handle("connection:clear", async () => {
    const status = await connectionManager?.clear();
    await deleteSecureValue("connection-target");
    await clearStoredAuth();
    mainWindow?.webContents.reload();
    return (
      status ?? {
        mode: "unconfigured",
        message: "No Gateway or Docker Engine connection is configured.",
        localGateway: false,
      }
    );
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    const callback = commandLine.find((argument) =>
      argument.startsWith("harbor-desk://"),
    );
    if (callback) void handleAuthCallback(callback);
    mainWindow?.show();
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    void handleAuthCallback(url);
  });
  app.whenReady().then(async () => {
    app.setAsDefaultProtocolClient("harbor-desk");
    await initializeConnection();
    registerIpc();
    createTray();
    await restoreAuth();
    await createWindow();
    const callback = process.argv.find((argument) =>
      argument.startsWith("harbor-desk://"),
    );
    if (callback) await handleAuthCallback(callback);
    app.on("activate", async () => {
      if (!mainWindow) await createWindow();
      else mainWindow.show();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", (event) => {
  const runtime = connectionManager;
  if (!runtime || gatewayShutdownStarted) return;

  event.preventDefault();
  gatewayShutdownStarted = true;
  void runtime
    .close()
    .catch((error) =>
      console.error("[connection] Local Gateway wrapper shutdown failed", {
        message: error instanceof Error ? error.message : String(error),
      }),
    )
    .finally(() => app.quit());
});
