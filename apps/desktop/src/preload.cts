import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("harbor", {
  platform: process.platform,
  version: process.versions.electron,
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
  secureStore: {
    set: (key: string, value: string) =>
      ipcRenderer.invoke("secure-store:set", key, value) as Promise<boolean>,
    get: (key: string) =>
      ipcRenderer.invoke("secure-store:get", key) as Promise<
        string | undefined
      >,
    delete: (key: string) =>
      ipcRenderer.invoke("secure-store:delete", key) as Promise<boolean>,
  },
  openExternal: (url: string) =>
    ipcRenderer.invoke("app:open-external", url) as Promise<boolean>,
  gateway: {
    getRuntimeStatus: () =>
      ipcRenderer.invoke("gateway:get-runtime-status") as Promise<{
        state: "managed" | "external" | "disabled" | "unavailable";
        url: string;
        message: string;
      }>,
    getSessionToken: () =>
      ipcRenderer.invoke("gateway:get-session-token") as Promise<
        string | undefined
      >,
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
