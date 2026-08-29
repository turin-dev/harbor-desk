import type { HostStatus } from "@harbor/contracts";

/**
 * Pure display copy for the application shell status bar.
 * Kept framework-free so it can be unit-tested without a DOM.
 */

type ConnectionMode =
  "unconfigured" | "detecting" | "gateway" | "engine" | "unavailable";

type UpdateCheckState =
  "idle" | "checking" | "available" | "up-to-date" | "error";

export function statusLabel(status: HostStatus): string {
  return status === "online"
    ? "Connected"
    : status === "offline"
      ? "Offline"
      : status === "degraded"
        ? "Degraded"
        : "Checking";
}

export function initials(value: string | undefined): string {
  const parts = value?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!parts.length) return "HD";
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function connectionModeLabel(
  mode: ConnectionMode | undefined,
  connectionUnavailable: boolean,
): string {
  return mode === "gateway"
    ? "Server Gateway"
    : mode === "engine"
      ? "Local Gateway wrapper"
      : mode === "detecting"
        ? "Detecting connection"
        : connectionUnavailable || mode === "unavailable"
          ? "Connection unavailable"
          : "Not configured";
}

export function updateStatusLabel(
  state: UpdateCheckState,
  latestVersion?: string,
): string {
  return state === "checking"
    ? "Checking for updates…"
    : state === "available"
      ? `Update ${latestVersion ?? ""} available`
      : state === "up-to-date"
        ? "Up to date"
        : state === "error"
          ? "Update check failed"
          : "Check for updates";
}

export function statusBarPrimaryText(input: {
  connectionUnavailable: boolean;
  host?: { displayName: string; status: HostStatus };
  connectionMode: ConnectionMode | undefined;
}): string {
  const { connectionUnavailable, host, connectionMode } = input;
  if (connectionUnavailable) return "Connection unavailable";
  if (host) return `${host.displayName} · ${statusLabel(host.status)}`;
  if (connectionMode === "engine")
    return "Local Gateway ready · No Engine host";
  if (connectionMode === "gateway")
    return "Server Gateway ready · No host selected";
  return "Configure a connection";
}
