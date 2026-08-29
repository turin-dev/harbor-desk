import test from "node:test";
import assert from "node:assert/strict";

import { enqueueOperation, parseRedisUrl, type OperationJob } from "./index.js";
import type { Queue } from "bullmq";

test("parseRedisUrl reads host, port, password, and database", () => {
  const parsed = parseRedisUrl("rediss://usr:p%40ss@10.0.0.5:7000/3");
  assert.deepEqual(parsed, {
    host: "10.0.0.5",
    port: 7000,
    password: "p@ss",
    db: 3,
  });
  assert.equal(parseRedisUrl("redis://127.0.0.1").port, 6379);
  assert.equal(parseRedisUrl("redis://127.0.0.1").password, undefined);
  assert.equal(parseRedisUrl("redis://127.0.0.1").db, undefined);
  assert.equal(parseRedisUrl("redis://127.0.0.1:6381").port, 6381);
  assert.equal(parseRedisUrl("redis://127.0.0.1/2").db, 2);
  assert.throws(() => parseRedisUrl("not a redis url"));
});
test("enqueueOperation uses the job kind, stable jobId, and bounded retention", async () => {
  const calls: Array<{ name: string; data: unknown; options: unknown }> = [];
  const queue = {
    add: async (name: string, data: unknown, options?: unknown) => {
      calls.push({ name, data, options });
      return { id: "queue-assigned-id" };
    },
  } as unknown as Queue<OperationJob>;
  const job: OperationJob = {
    operationId: "op-1",
    kind: "image-scan",
    hostId: "host-1",
    payload: { image: "alpine" },
  };
  const returned = await enqueueOperation(queue, job);
  assert.equal(returned, "queue-assigned-id");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.name, "image-scan");
  assert.deepEqual(calls[0]!.data, job);
  const options = calls[0]!.options as {
    jobId: string;
    removeOnComplete: number;
    removeOnFail: number;
  };
  assert.equal(options.jobId, "op-1");
  assert.equal(options.removeOnComplete, 100);
  assert.equal(options.removeOnFail, 100);
});

test("enqueueOperation honors caller overrides on top of the defaults", async () => {
  const calls: Array<{ options: unknown }> = [];
  const queue = {
    add: async (_name: string, _data: unknown, options?: unknown) => {
      calls.push({ options });
      return { id: null };
    },
  } as unknown as Queue<OperationJob>;
  const job: OperationJob = {
    operationId: "op-2",
    kind: "build",
    payload: {},
  };
  const returned = await enqueueOperation(queue, job, {
    attempts: 3,
    removeOnComplete: 10,
  });
  assert.equal(returned, "op-2");
  const options = calls[0]!.options as {
    jobId: string;
    attempts: number;
    removeOnComplete: number;
    removeOnFail: number;
  };
  assert.equal(options.jobId, "op-2");
  assert.equal(options.attempts, 3);
  assert.equal(options.removeOnComplete, 10);
  assert.equal(options.removeOnFail, 100);
});
