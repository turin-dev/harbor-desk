import assert from "node:assert/strict";
import test from "node:test";
import { isPruneActive, isPruneFinal } from "./prune-state.js";

test("treats pending, queued, and running prune operations as active", () => {
  assert.equal(isPruneActive(true, undefined), true);
  assert.equal(isPruneActive(false, "queued"), true);
  assert.equal(isPruneActive(false, "running"), true);
  assert.equal(isPruneActive(false, "succeeded"), false);
  assert.equal(isPruneActive(false, "failed"), false);
  assert.equal(isPruneActive(false, "cancelled"), false);
  assert.equal(isPruneActive(false, undefined), false);
});

test("marks only terminal prune statuses as final", () => {
  assert.equal(isPruneFinal("succeeded"), true);
  assert.equal(isPruneFinal("failed"), true);
  assert.equal(isPruneFinal("cancelled"), true);
  assert.equal(isPruneFinal("queued"), false);
  assert.equal(isPruneFinal("running"), false);
  assert.equal(isPruneFinal(undefined), false);
});
