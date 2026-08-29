import { randomUUID } from "node:crypto";
import {
  OperationCancelledError,
  type Operation,
  type OperationStatus,
} from "@harbor/contracts";
import { HttpError as ConnectorHttpError } from "@harbor/connectors";
import { HttpError, problemFromError } from "../errors.js";
import type { EventHub } from "./events.js";

interface OperationInput {
  kind: string;
  hostId?: string;
  operationId?: string;
  idempotencyKey?: string;
  requestId: string;
}

export function isOperationCancelledError(error: unknown): boolean {
  if (error instanceof OperationCancelledError) return true;
  if (error instanceof ConnectorHttpError)
    return error.code === "operation_cancelled";
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "operation_cancelled"
  );
}

export class OperationStore {
  private readonly operations = new Map<string, Operation>();
  private readonly idempotency = new Map<string, string>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly settles = new Map<string, Promise<void>>();

  constructor(private readonly events?: EventHub) {}

  public async run(
    input: OperationInput,
    task: (signal?: AbortSignal) => Promise<void>,
  ): Promise<Operation> {
    const idempotencyKey = input.idempotencyKey?.trim();
    const existingId = idempotencyKey
      ? this.idempotency.get(this.idempotencyKey(input, idempotencyKey))
      : undefined;
    if (existingId) return this.get(existingId);

    const id = input.operationId?.trim() || randomUUID();
    if (this.operations.has(id)) return this.get(id);

    const operation: Operation = {
      id,
      hostId: input.hostId,
      kind: input.kind,
      status: "queued",
      startedAt: new Date().toISOString(),
    };
    this.operations.set(id, operation);
    if (idempotencyKey)
      this.idempotency.set(this.idempotencyKey(input, idempotencyKey), id);
    this.publish(operation);

    operation.status = "running";
    this.publish(operation);
    const controller = new AbortController();
    this.controllers.set(operation.id, controller);
    const settle = (async () => {
      try {
        await task(controller.signal);
        operation.status = "succeeded";
        operation.progress = 100;
        operation.finishedAt = new Date().toISOString();
        operation.message = "Operation completed.";
        this.publish(operation);
      } catch (error) {
        if (isOperationCancelledError(error)) {
          this.markCancelled(operation);
        } else {
          operation.status = "failed";
          operation.finishedAt = new Date().toISOString();
          operation.error = problemFromError(error, input.requestId);
          operation.message = operation.error.message;
          this.publish(operation);
        }
      } finally {
        this.controllers.delete(operation.id);
        this.settles.delete(operation.id);
      }
    })();
    this.settles.set(operation.id, settle);
    await settle;
    return this.get(operation.id);
  }

  public get(operationId: string): Operation {
    const operation = this.operations.get(operationId);
    if (!operation)
      throw new HttpError(
        404,
        "operation_not_found",
        "Operation was not found.",
      );
    return {
      ...operation,
      ...(operation.error ? { error: { ...operation.error } } : {}),
    };
  }

  public setProgress(
    operationId: string,
    progress: number,
    message?: string,
  ): void {
    const operation = this.operations.get(operationId);
    if (!operation) return;
    const clamped = Math.max(0, Math.min(100, Math.floor(progress)));
    operation.progress = clamped;
    if (message) operation.message = message;
  }

  public async cancel(operationId: string): Promise<Operation> {
    const operation = this.operations.get(operationId);
    if (!operation)
      throw new HttpError(
        404,
        "operation_not_found",
        "Operation was not found.",
      );
    if (operation.status === "queued") {
      operation.status = "cancelled";
      operation.finishedAt = new Date().toISOString();
      operation.message = "Operation cancelled.";
      this.publish(operation);
      return this.get(operationId);
    }
    if (operation.status === "running") {
      const controller = this.controllers.get(operationId);
      const settle = this.settles.get(operationId);
      if (controller && settle) {
        controller.abort();
        await Promise.race([
          settle,
          new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
        ]);
        return this.get(operationId);
      }
      throw new HttpError(
        409,
        "operation_not_cancellable",
        "The operation is already running and cannot be cancelled by this gateway.",
      );
    }
    return this.get(operationId);
  }

  private markCancelled(operation: Operation): void {
    operation.status = "cancelled";
    operation.finishedAt = new Date().toISOString();
    operation.message = "Operation cancelled.";
    this.publish(operation);
  }

  public status(operationId: string): OperationStatus {
    return this.get(operationId).status;
  }

  private idempotencyKey(input: OperationInput, key: string): string {
    return `${input.hostId ?? "global"}:${input.kind}:${key}`;
  }

  private publish(operation: Operation): void {
    if (!this.events || !operation.hostId) return;
    this.events.publish({
      hostId: operation.hostId,
      type: `operation.${operation.status}`,
      resourceKind: "operation",
      resourceId: operation.id,
      payload: this.get(operation.id),
      occurredAt: new Date().toISOString(),
    });
  }
}
