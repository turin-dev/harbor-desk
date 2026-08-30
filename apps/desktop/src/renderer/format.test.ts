import assert from "node:assert/strict";
import { test } from "node:test";
import { formatBytes, formatDate, formatTime } from "./format.js";

test("formatBytes renders empty values as a dash", () => {
  assert.equal(formatBytes(undefined), "—");
  assert.equal(formatBytes(0), "—");
});

test("formatBytes stays integral at KB and below", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(1536), "2 KB");
});

test("formatBytes scales through MB, GB and TB", () => {
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(1024 * 1024 * 1024), "1.0 GB");
  assert.equal(formatBytes(2 * 1024 * 1024 * 1024 * 1024), "2.0 TB");
});

test("formatBytes caps at the TB unit", () => {
  assert.equal(formatBytes(2048 * 1024 * 1024 * 1024 * 1024), "2048.0 TB");
});

test("formatDate falls back for missing or invalid values", () => {
  assert.equal(formatDate(undefined), "—");
  assert.equal(formatDate(""), "—");
  assert.equal(formatDate("not-a-date"), "not-a-date");
  assert.ok(formatDate("2026-08-30T09:00:00.000Z").includes("2026"));
});

test("formatTime keeps invalid input and renders valid dates", () => {
  assert.equal(formatTime("nope"), "nope");
  assert.ok(formatTime("2026-08-30T09:00:00.000Z").includes("2026"));
});
