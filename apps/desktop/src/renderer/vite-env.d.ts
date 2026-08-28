/// <reference types="vite/client" />

type DesktopUpdateCheckState =
  "idle" | "checking" | "available" | "up-to-date" | "error";

interface DesktopUpdateCheckStatus {
  state: DesktopUpdateCheckState;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  checkedAt?: string;
  message: string;
}

interface Window {
  harbor?: {
    platform: string;
    version: string;
    electronVersion: string;
    setLaunchAtLogin: (enabled: boolean) => Promise<boolean>;
    windowControls: {
      minimize: () => Promise<boolean>;
      toggleMaximize: () => Promise<boolean>;
      close: () => Promise<boolean>;
    };
    selectFile: (options?: {
      extensions?: string[];
    }) => Promise<string | undefined>;
    secureStore: {
      set: (key: string, value: string) => Promise<boolean>;
      get: (key: string) => Promise<string | undefined>;
      delete: (key: string) => Promise<boolean>;
    };
    openExternal: (url: string) => Promise<boolean>;
    updates: {
      getStatus: () => Promise<DesktopUpdateCheckStatus>;
      check: (options?: {
        includePrerelease?: boolean;
        manual?: boolean;
      }) => Promise<DesktopUpdateCheckStatus>;
      openRelease: () => Promise<boolean>;
      onStatus: (
        listener: (status: DesktopUpdateCheckStatus) => void,
      ) => () => void;
    };
    gateway: {
      getRuntimeStatus: () => Promise<{
        state: "managed" | "external" | "disabled" | "unavailable";
        url: string;
        message: string;
      }>;
      getSessionToken: () => Promise<string | undefined>;
    };
    auth: {
      startLogin: (providerId: string) => Promise<boolean>;
      getAccessToken: () => Promise<string | undefined>;
      refresh: () => Promise<boolean>;
      logout: () => Promise<boolean>;
      onChanged: (listener: () => void) => () => void;
    };
  };
}
