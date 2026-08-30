import assert from "node:assert/strict";
import test from "node:test";
import {
  canSubmitConnectionTarget,
  classifyConfigureResult,
  configureErrorMessage,
  defaultDisplayName,
} from "./connection-dialog.js";

test("prefers the Gateway display name only in gateway mode", () => {
  assert.equal(defaultDisplayName("gateway"), "Harbor Desk Gateway");
  assert.equal(defaultDisplayName("engine"), "Docker Engine");
  assert.equal(defaultDisplayName("unconfigured"), "Docker Engine");
  assert.equal(defaultDisplayName("detecting"), "Docker Engine");
  assert.equal(defaultDisplayName("unavailable"), "Docker Engine");
  assert.equal(defaultDisplayName(undefined), "Docker Engine");
});

test("requires a non-blank endpoint to submit", () => {
  assert.equal(canSubmitConnectionTarget("https://gw.example"), true);
  assert.equal(canSubmitConnectionTarget("  "), false);
  assert.equal(canSubmitConnectionTarget(""), false);
});

test("classifies configure results as connected or failed", () => {
  assert.deepEqual(
    classifyConfigureResult({ mode: "gateway", message: "ok" }),
    {
      kind: "connected",
    },
  );
  assert.deepEqual(classifyConfigureResult({ mode: "engine", message: "ok" }), {
    kind: "connected",
  });
  assert.deepEqual(
    classifyConfigureResult({ mode: "unavailable", message: "no route" }),
    { kind: "failed", message: "no route" },
  );
});

test("surfaces Error messages and falls back for unknown rejections", () => {
  assert.equal(
    configureErrorMessage(new Error("engine offline")),
    "engine offline",
  );
  assert.equal(
    configureErrorMessage("plain string"),
    "The connection target could not be configured.",
  );
  assert.equal(
    configureErrorMessage(null),
    "The connection target could not be configured.",
  );
});
