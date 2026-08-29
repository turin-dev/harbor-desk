/**
 * Pure decision policy shared by the react-query hooks in queries.ts.
 * Kept framework-free so it can be unit-tested without a DOM.
 */

const OPERATION_REFETCH_MS = 2_000;
export const DEFAULT_AUDIT_LIMIT = 200;

export function isOperationFinalStatus(status?: string): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled"
  );
}

export function operationRefetchInterval(status?: string): false | number {
  return isOperationFinalStatus(status) ? false : OPERATION_REFETCH_MS;
}

export function defaultAuditLimit(limit?: number): number {
  return limit ?? DEFAULT_AUDIT_LIMIT;
}

export function defaultPruneAll(all?: boolean): boolean {
  return all ?? false;
}

export function defaultDeleteForce(force?: boolean): boolean {
  return force ?? false;
}

export function withDefaultOperationId(
  operationId?: string,
  randomUuid: () => string = () => crypto.randomUUID(),
): string {
  return operationId ?? randomUuid();
}
