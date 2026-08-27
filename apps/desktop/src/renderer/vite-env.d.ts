/// <reference types="vite/client" />

interface Window {
  harbor?: {
    platform: string;
    version: string;
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
    auth: {
      startLogin: (providerId: string) => Promise<boolean>;
      getAccessToken: () => Promise<string | undefined>;
      refresh: () => Promise<boolean>;
      logout: () => Promise<boolean>;
      onChanged: (listener: () => void) => () => void;
    };
  };
}
