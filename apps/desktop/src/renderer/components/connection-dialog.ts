/**
 * Pure policy for the connection target dialog, kept framework-free for tests.
 */

export type DialogMode =
  "gateway" | "engine" | "unconfigured" | "detecting" | "unavailable";

export function defaultDisplayName(mode: DialogMode | undefined): string {
  return mode === "gateway" ? "Harbor Desk Gateway" : "Docker Engine";
}

export function canSubmitConnectionTarget(endpoint: string): boolean {
  return endpoint.trim().length > 0;
}

export type ConfigureOutcome =
  { kind: "connected" } | { kind: "failed"; message: string };

export function classifyConfigureResult(status: {
  mode: string;
  message: string;
}): ConfigureOutcome {
  return status.mode === "unavailable"
    ? { kind: "failed", message: status.message }
    : { kind: "connected" };
}

export const connectionFallbackErrorMessage =
  "The connection target could not be configured.";

export function configureErrorMessage(caught: unknown): string {
  return caught instanceof Error
    ? caught.message
    : connectionFallbackErrorMessage;
}
