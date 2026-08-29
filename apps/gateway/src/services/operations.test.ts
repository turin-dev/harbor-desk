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

test("cancels a running operation through its abort signal", async () => {
  const events = new EventHub();
  const store = new OperationStore(events);
  let started = false;
  const running = store.run(
    {
      kind: "image.pull",
      hostId: "host-1",
      operationId: "cancel-run-1",
      requestId: "req-5",
    },
    (signal) =>
      new Promise<void>((_resolve, reject) => {
        started = true;
        signal?.addEventListener(
          "abort",
          () =>
            reject(
              Object.assign(new Error("aborted"), {
                code: "operation_cancelled",
              }),
            ),
          { once: true },
        );
      }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(started, "expected the task to be running before cancel");
  const cancelled = await store.cancel("cancel-run-1");
  const settled = await running;
  assert.equal(cancelled.id, "cancel-run-1");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(settled.id, "cancel-run-1");
  assert.equal(settled.status, "cancelled");
  assert.equal(settled.error, undefined);
  assert.equal(settled.message, "Operation cancelled.");
  assert.deepEqual(
    events.since().map((event) => event.type),
    ["operation.queued", "operation.running", "operation.cancelled"],
  );
});

test("returns terminal operations unchanged when cancelling", async () => {
  const store = new OperationStore();
  const operation = await store.run(
    { kind: "container.start", hostId: "host-1", requestId: "req-6" },
    async () => undefined,
  );
  const unchanged = await store.cancel(operation.id);
  assert.equal(unchanged.id, operation.id);
  assert.equal(unchanged.status, "succeeded");
});
