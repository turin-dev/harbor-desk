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
    connection: {
      getStatus: () => Promise<{
        mode:
          "unconfigured" | "detecting" | "gateway" | "engine" | "unavailable";
        endpoint?: string;
        gatewayUrl?: string;
        message: string;
        localGateway: boolean;
        engineHostId?: string;
        engineOnline?: boolean;
      }>;
      getSessionToken: () => Promise<string | undefined>;
      reconnect: () => Promise<{
        mode:
          "unconfigured" | "detecting" | "gateway" | "engine" | "unavailable";
        endpoint?: string;
        gatewayUrl?: string;
        message: string;
        localGateway: boolean;
        engineHostId?: string;
        engineOnline?: boolean;
      }>;
      configure: (input: {
        endpoint: string;
        displayName?: string;
        ca?: string;
        cert?: string;
        key?: string;
      }) => Promise<{
        mode:
          "unconfigured" | "detecting" | "gateway" | "engine" | "unavailable";
        endpoint?: string;
        gatewayUrl?: string;
        message: string;
        localGateway: boolean;
        engineHostId?: string;
        engineOnline?: boolean;
      }>;
      clear: () => Promise<{
        mode: "unconfigured";
        message: string;
        localGateway: false;
      }>;
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
      ) => () => void;
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
