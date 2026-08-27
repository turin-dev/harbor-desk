import { randomUUID } from "node:crypto";
import type { AuditEvent } from "@harbor/contracts";

export interface AuditInput {
  actorId: string;
  hostId?: string;
  action: string;
  resourceKind?: string;
  resourceId?: string;
  result: AuditEvent["result"];
  requestId: string;
}

export class AuditStore {
  private readonly events: AuditEvent[] = [];

  public record(input: AuditInput): AuditEvent {
    const event: AuditEvent = {
      id: randomUUID(),
      ...input,
      occurredAt: new Date().toISOString(),
    };
    this.events.push(event);
    if (this.events.length > 5_000) this.events.shift();
    return { ...event };
  }

  public list(limit = 100): AuditEvent[] {
    return this.events
      .slice(-Math.max(1, Math.min(limit, 500)))
      .reverse()
      .map((event) => ({ ...event }));
  }
}
