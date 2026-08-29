import test from "node:test";
import assert from "node:assert/strict";

import { EventHub } from "./events.js";
import type { EventEnvelope } from "@harbor/contracts";

function makeEvent(overrides: Partial<Omit<EventEnvelope, "cursor">> = {}) {
  return {
    hostId: "host-1",
    type: "container.stopped",
    resourceKind: "container",
    resourceId: "c1",
    payload: {},
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

test("publish stamps a unique, monotonically ordered cursor", () => {
  const hub = new EventHub();
  const first = hub.publish(makeEvent());
  const second = hub.publish(makeEvent({ type: "container.started" }));
  assert.notEqual(first.cursor, second.cursor);
  assert.ok(second.cursor.endsWith("-2"));
  assert.ok(first.cursor.endsWith("-1"));
  assert.deepEqual(hub.since(), [first, second]);
});

test("since(cursor) returns only events after the given cursor", () => {
  const hub = new EventHub();
  const first = hub.publish(makeEvent());
  hub.publish(makeEvent({ type: "container.started" }));
  hub.publish(makeEvent({ type: "image.pulled" }));
  const rest = hub.since(first.cursor);
  assert.equal(rest.length, 2);
  assert.equal(rest[0]!.type, "container.started");
  assert.equal(rest[1]!.type, "image.pulled");
  assert.deepEqual(hub.since("unknown-cursor"), hub.since());
});

test("history is capped at 500 envelopes and the oldest are dropped", () => {
  const hub = new EventHub();
  for (let i = 0; i < 505; i++) {
    hub.publish(makeEvent({ resourceId: `c${i}` }));
  }
  const history = hub.since();
  assert.equal(history.length, 500);
  assert.equal(history[0]!.resourceId, "c5");
  assert.equal(history[499]!.resourceId, "c504");
});

test("subscribe delivers live events and the unsubscribe stops delivery", () => {
  const hub = new EventHub();
  const seen: EventEnvelope[] = [];
  const unsubscribe = hub.subscribe((event) => seen.push(event));
  hub.publish(makeEvent());
  unsubscribe();
  hub.publish(makeEvent({ type: "container.started" }));
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.type, "container.stopped");
});
