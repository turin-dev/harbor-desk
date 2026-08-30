import { contextBridge, ipcRenderer } from "electron";

interface UpdateCheckStatus {
  state: "idle" | "checking" | "available" | "up-to-date" | "error";
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  checkedAt?: string;
  message: string;
}

contextBridge.exposeInMainWorld("harbor", {
  platform: process.platform,
  version: process.versions.electron,
  electronVersion: process.versions.electron,
  setLaunchAtLogin: (enabled: boolean) =>
    ipcRenderer.invoke("app:set-launch-at-login", enabled) as Promise<boolean>,
  windowControls: {
    minimize: () =>
      ipcRenderer.invoke("app:window-control", "minimize") as Promise<boolean>,
    toggleMaximize: () =>
      ipcRenderer.invoke(
        "app:window-control",
        "toggleMaximize",
      ) as Promise<boolean>,
    close: () =>
      ipcRenderer.invoke("app:window-control", "close") as Promise<boolean>,
  },
  selectFile: (options?: { extensions?: string[] }) =>
    ipcRenderer.invoke("app:select-file", options) as Promise<
      string | undefined
    >,
  selectFolder: () =>
    ipcRenderer.invoke("app:select-folder") as Promise<string | undefined>,
  buildContext: (folder: string) =>
    ipcRenderer.invoke("app:build-context", folder) as Promise<{
      base64Tar: string;
      entries: Array<{
        path: string;
        sizeBytes: number;
        mode: "file" | "directory";
      }>;
      totalBytes: number;
    }>,
  openExternal: (url: string) =>
    ipcRenderer.invoke("app:open-external", url) as Promise<boolean>,
  updates: {
    getStatus: () =>
      ipcRenderer.invoke("updates:get-status") as Promise<UpdateCheckStatus>,
    check: (options?: { includePrerelease?: boolean; manual?: boolean }) =>
      ipcRenderer.invoke(
        "updates:check",
        options,
      ) as Promise<UpdateCheckStatus>,
    openRelease: () =>
      ipcRenderer.invoke("updates:open-release") as Promise<boolean>,
    onStatus: (listener: (status: UpdateCheckStatus) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        status: UpdateCheckStatus,
      ) => listener(status);
      ipcRenderer.on("updates:status", handler);
      return () => ipcRenderer.off("updates:status", handler);
    },
  },
  connection: {
    getStatus: () =>
      ipcRenderer.invoke("connection:get-status") as Promise<{
        mode:
          "unconfigured" | "detecting" | "gateway" | "engine" | "unavailable";
        endpoint?: string;
        gatewayUrl?: string;
        message: string;
        localGateway: boolean;
        engineHostId?: string;
        engineOnline?: boolean;
      }>,
    getSessionToken: () =>
      ipcRenderer.invoke("connection:get-session-token") as Promise<
        string | undefined
      >,
    reconnect: () =>
      ipcRenderer.invoke("connection:reconnect") as Promise<{
        mode:
          "unconfigured" | "detecting" | "gateway" | "engine" | "unavailable";
        endpoint?: string;
        gatewayUrl?: string;
        message: string;
        localGateway: boolean;
        engineHostId?: string;
        engineOnline?: boolean;
      }>,
    configure: (input: {
      endpoint: string;
      displayName?: string;
      ca?: string;
      cert?: string;
      key?: string;
    }) =>
      ipcRenderer.invoke("connection:configure", input) as Promise<{
        mode:
          "unconfigured" | "detecting" | "gateway" | "engine" | "unavailable";
        endpoint?: string;
        gatewayUrl?: string;
        message: string;
        localGateway: boolean;
        engineHostId?: string;
        engineOnline?: boolean;
      }>,
    clear: () =>
      ipcRenderer.invoke("connection:clear") as Promise<{
        mode: "unconfigured";
        message: string;
        localGateway: false;
      }>,
    onChanged: (
      listener: (status: {
        mode:
          "unconfigured" | "detecting" | "gateway" | "engine" | "unavailable";
        endpoint?: string;
        gatewayUrl?: string;
        message: string;
        localGateway: boolean;
        engineHostId?: string;
        engineOnline?: boolean;
      }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        status: Parameters<typeof listener>[0],
      ) => listener(status);
      ipcRenderer.on("connection:changed", handler);
      return () => ipcRenderer.off("connection:changed", handler);
    },
  },
  auth: {
    startLogin: (providerId: string) =>
      ipcRenderer.invoke("auth:start", providerId) as Promise<boolean>,
    getAccessToken: () =>
      ipcRenderer.invoke("auth:get-access-token") as Promise<
        string | undefined
      >,
    refresh: () => ipcRenderer.invoke("auth:refresh") as Promise<boolean>,
    logout: () => ipcRenderer.invoke("auth:logout") as Promise<boolean>,
    onChanged: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("auth:changed", handler);
      return () => ipcRenderer.off("auth:changed", handler);
    },
  },
});
