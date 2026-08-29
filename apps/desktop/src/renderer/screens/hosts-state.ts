import type { DesktopConnectionStatus } from "../api/client.js";

export interface HostsEmptyState {
  title: string;
  description: string;
  tone: "primary" | "error";
  action?: {
    kind: "retry-hosts" | "configure";
    label: string;
  };
}

export function resolveHostsEmptyState(
  status: DesktopConnectionStatus | undefined,
  hostsError: boolean,
): HostsEmptyState {
  if (hostsError)
    return {
      title: "Could not load remote hosts",
      description:
        "The active Gateway could not return its host list. Retry the host list or inspect Troubleshoot for connection details.",
      tone: "error",
      action: { kind: "retry-hosts", label: "Retry host list" },
    };

  if (status?.mode === "unconfigured")
    return {
      title: "Connect a Gateway or Docker Engine",
      description:
        "Configure a Harbor Desk Gateway or Docker Engine target before managing remote hosts.",
      tone: "primary",
      action: { kind: "configure", label: "Configure connection" },
    };

  if (status?.mode === "unavailable")
    return {
      title: "Connection unavailable",
      description:
        status.message ||
        "The configured connection could not be reached. Check the target and try again.",
      tone: "error",
      action: { kind: "configure", label: "Change connection" },
    };

  if (status?.mode === "detecting")
    return {
      title: "Connecting to the configured target",
      description:
        "Harbor Desk is still detecting the Gateway or Docker Engine. Host data will appear when the connection is ready.",
      tone: "primary",
    };

  if (status?.mode === "gateway" || status?.mode === "engine")
    return {
      title: "Gateway ready · No Engine host connected",
      description:
        "Add an HTTPS Engine endpoint with the credentials required by the active Gateway. Raw Engine targets entered in Settings are wrapped locally and do not appear as a second raw connection.",
      tone: "primary",
    };

  return {
    title: "Waiting for a connection",
    description:
      "Harbor Desk is waiting for the active Gateway or Docker Engine connection status.",
    tone: "primary",
  };
}
