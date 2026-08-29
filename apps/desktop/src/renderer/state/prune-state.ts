export type PruneOperationStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";

export function isPruneActive(
  isPending: boolean,
  operationStatus?: PruneOperationStatus,
): boolean {
  return (
    isPending || operationStatus === "queued" || operationStatus === "running"
  );
}

export function isPruneFinal(operationStatus?: PruneOperationStatus): boolean {
  return (
    operationStatus === "succeeded" ||
    operationStatus === "failed" ||
    operationStatus === "cancelled"
  );
}
