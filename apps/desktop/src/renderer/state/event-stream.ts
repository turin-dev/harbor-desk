/**
 * Pure policy for the remote event stream hook.
 * Kept framework-free so the reconnect backoff and filtering can be unit-tested.
 */

export const initialReconnectDelayMs = 1_000;
export const maximumReconnectDelayMs = 10_000;
export const stableConnectionResetMs = 5_000;

export function resourceQueryKey(
  resourceKind: string,
): "containers" | "images" | "volumes" | "networks" | undefined {
  const kind = resourceKind.toLowerCase();
  if (kind === "container") return "containers";
  if (kind === "image") return "images";
  if (kind === "volume") return "volumes";
  if (kind === "network") return "networks";
  return undefined;
}

export function isEventForHost(
  event: { cursor?: unknown; hostId?: unknown },
  hostId: string,
): boolean {
  return (
    typeof event.cursor === "string" &&
    event.cursor.length > 0 &&
    event.hostId === hostId
  );
}

export function nextReconnectDelay(currentDelayMs: number): number {
  return Math.min(currentDelayMs * 2, maximumReconnectDelayMs);
}

export class ReconnectSchedule {
  private delayMs = initialReconnectDelayMs;

  public readonly nextDelayMs = (): number => this.delayMs;

  public readonly arm = (): number => {
    const delay = this.delayMs;
    this.delayMs = nextReconnectDelay(this.delayMs);
    return delay;
  };

  public readonly reset = (): void => {
    this.delayMs = initialReconnectDelayMs;
  };
}
