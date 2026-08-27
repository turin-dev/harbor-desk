import { randomUUID } from "node:crypto";
import type { Operation, OperationStatus } from "@harbor/contracts";
import { HttpError, problemFromError } from "../errors.js";
import type { EventHub } from "./events.js";

interface OperationInput {
  kind: string;
  hostId?: string;
  idempotencyKey?: string;
  requestId: string;
}

export class OperationStore {
  private readonly operations = new Map<string, Operation>();
  private readonly idempotency = new Map<string, string>();

  constructor(private readonly events?: EventHub) {}

  public async run(
    input: OperationInput,
    task: () => Promise<void>,
  ): Promise<Operation> {
    const idempotencyKey = input.idempotencyKey?.trim();
    const existingId = idempotencyKey
      ? this.idempotency.get(this.idempotencyKey(input, idempotencyKey))
      : undefined;
    if (existingId) return this.get(existingId);

    const operation: Operation = {
      id: randomUUID(),
      hostId: input.hostId,
      kind: input.kind,
      status: "queued",
      startedAt: new Date().toISOString(),
    };
    this.operations.set(operation.id, operation);
    if (idempotencyKey)
      this.idempotency.set(
        this.idempotencyKey(input, idempotencyKey),
        operation.id,
      );
    this.publish(operation);

    operation.status = "running";
    this.publish(operation);
    try {
      await task();
      operation.status = "succeeded";
      operation.progress = 100;
      operation.finishedAt = new Date().toISOString();
      operation.message = "Operation completed.";
      this.publish(operation);
    } catch (error) {
      operation.status = "failed";
      operation.finishedAt = new Date().toISOString();
      operation.error = problemFromError(error, input.requestId);
      operation.message = operation.error.message;
      this.publish(operation);
    }
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

  public cancel(operationId: string): Operation {
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
      throw new HttpError(
        409,
        "operation_not_cancellable",
        "The operation is already running and cannot be cancelled by this gateway.",
      );
    }
    return this.get(operationId);
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
