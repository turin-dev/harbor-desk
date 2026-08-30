import assert from "node:assert/strict";
import test from "node:test";
import {
  maximumReconnectDelayMs,
  nextReconnectDelay,
  ReconnectSchedule,
  resourceQueryKey,
  stableConnectionResetMs,
  isEventForHost,
} from "./event-stream.js";

test("maps resource kinds to their list query keys", () => {
  assert.equal(resourceQueryKey("container"), "containers");
  assert.equal(resourceQueryKey("Container"), "containers");
  assert.equal(resourceQueryKey("image"), "images");
  assert.equal(resourceQueryKey("volume"), "volumes");
  assert.equal(resourceQueryKey("network"), "networks");
  assert.equal(resourceQueryKey("engine"), undefined);
  assert.equal(resourceQueryKey(""), undefined);
});

test("keeps only well-formed events for the connected host", () => {
  assert.equal(isEventForHost({ cursor: "c1", hostId: "h1" }, "h1"), true);
  assert.equal(isEventForHost({ cursor: "c1", hostId: "h2" }, "h1"), false);
  assert.equal(isEventForHost({ hostId: "h1" }, "h1"), false);
  assert.equal(isEventForHost({ cursor: "", hostId: "h1" }, "h1"), false);
  assert.equal(isEventForHost({ cursor: 5, hostId: "h1" }, "h1"), false);
});

test("doubles the reconnect delay up to the ten-second cap", () => {
  assert.equal(nextReconnectDelay(1_000), 2_000);
  assert.equal(nextReconnectDelay(2_000), 4_000);
  assert.equal(nextReconnectDelay(4_000), 8_000);
  assert.equal(nextReconnectDelay(8_000), 10_000);
  assert.equal(nextReconnectDelay(10_000), 10_000);
  assert.equal(maximumReconnectDelayMs, 10_000);
  assert.equal(stableConnectionResetMs, 5_000);
});

test("arms successive backoff delays and resets after a stable connection", () => {
  const schedule = new ReconnectSchedule();
  assert.equal(schedule.nextDelayMs(), 1_000);
  assert.equal(schedule.arm(), 1_000);
  assert.equal(schedule.arm(), 2_000);
  assert.equal(schedule.arm(), 4_000);
  assert.equal(schedule.arm(), 8_000);
  assert.equal(schedule.arm(), 10_000);
  assert.equal(schedule.arm(), 10_000);
  schedule.reset();
  assert.equal(schedule.arm(), 1_000);
});
