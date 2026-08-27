import { EventEmitter } from "node:events";
import type { EventEnvelope } from "@harbor/contracts";

export class EventHub {
  private readonly emitter = new EventEmitter();
  private readonly history: EventEnvelope[] = [];
  private sequence = 0;

  public publish(event: Omit<EventEnvelope, "cursor">): EventEnvelope {
    const next: EventEnvelope = {
      ...event,
      cursor: `${Date.now()}-${++this.sequence}`,
    };
    this.history.push(next);
    if (this.history.length > 500) this.history.shift();
    this.emitter.emit("event", next);
    return next;
  }

  public since(cursor?: string): EventEnvelope[] {
    if (!cursor) return [...this.history];
    const index = this.history.findIndex((event) => event.cursor === cursor);
    return index < 0 ? [...this.history] : this.history.slice(index + 1);
  }

  public subscribe(listener: (event: EventEnvelope) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
