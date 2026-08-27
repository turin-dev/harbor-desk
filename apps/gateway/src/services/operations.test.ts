import test from "node:test";
import assert from "node:assert/strict";
import { OperationStore } from "./operations.js";
import { EventHub } from "./events.js";

test("returns the same completed operation for a repeated idempotency key", async () => {
  const store = new OperationStore();
  let runs = 0;
  const first = await store.run(
    {
      kind: "container.start",
      hostId: "host-1",
      idempotencyKey: "request-1",
      requestId: "req-1",
    },
    async () => {
      runs += 1;
    },
  );
  const second = await store.run(
    {
      kind: "container.start",
      hostId: "host-1",
      idempotencyKey: "request-1",
      requestId: "req-2",
    },
    async () => {
      runs += 1;
    },
  );

  assert.equal(runs, 1);
  assert.equal(second.id, first.id);
  assert.equal(second.status, "succeeded");
  assert.equal(second.progress, 100);
});

test("records a sanitized problem when an operation fails", async () => {
  const store = new OperationStore();
  const operation = await store.run(
    { kind: "container.delete", hostId: "host-1", requestId: "req-3" },
    async () => {
      throw new Error("upstream private detail");
    },
  );

  assert.equal(operation.status, "failed");
  assert.equal(operation.error?.code, "internal_error");
  assert.equal(
    operation.error?.message,
    "The gateway could not complete the request.",
  );
  assert.equal(operation.error?.requestId, "req-3");
});

test("publishes host-scoped lifecycle events for operation progress", async () => {
  const events = new EventHub();
  const store = new OperationStore(events);
  const operation = await store.run(
    { kind: "image.pull", hostId: "host-1", requestId: "req-4" },
    async () => undefined,
  );

  assert.deepEqual(
    events.since().map((event) => event.type),
    ["operation.queued", "operation.running", "operation.succeeded"],
  );
  assert.equal(events.since().at(-1)?.resourceId, operation.id);
});
