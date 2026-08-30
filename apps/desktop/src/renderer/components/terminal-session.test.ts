import assert from "node:assert/strict";
import test from "node:test";
import {
  appendToHistory,
  applyTerminalFrame,
  canRunTerminalCommand,
  isTerminalFrame,
  maximumHistoryEntries,
  promptLine,
  requestErrorMessage,
  terminalFrameErrorMessage,
} from "./terminal-session.js";

test("prepends the command, dedupes it, and caps history at 30 entries", () => {
  let history = appendToHistory([], "ls");
  assert.deepEqual(history, ["ls"]);
  history = appendToHistory(history, "top");
  assert.deepEqual(history, ["top", "ls"]);
  history = appendToHistory(history, "ls");
  assert.deepEqual(history, ["ls", "top"]);
  history = Array.from({ length: 40 }, (_, i) => "cmd-" + i);
  const capped = appendToHistory(history, "cmd-0");
  assert.equal(capped.length, maximumHistoryEntries);
  assert.equal(capped[0], "cmd-0");
  assert.equal(capped[1], "cmd-1");
  assert.equal(capped[29], "cmd-29");
});

test("builds the prompt line with a fallback container name", () => {
  assert.equal(promptLine("web", "uname -a"), "harbor@web:~$ uname -a");
  assert.equal(
    promptLine(undefined, "uname -a"),
    "harbor@container:~$ uname -a",
  );
});

test("appends stdout and stderr frames to the output", () => {
  const base = { output: [], error: undefined, running: true };
  const afterStdout = applyTerminalFrame(base, {
    type: "stdout",
    data: "hello",
  });
  assert.deepEqual(afterStdout.output, ["hello"]);
  assert.equal(afterStdout.running, true);
  const afterStderr = applyTerminalFrame(afterStdout, {
    type: "stderr",
    data: "oops",
  });
  assert.deepEqual(afterStderr.output, ["hello", "oops"]);
  assert.equal(afterStderr.error, undefined);
  assert.equal(afterStderr.running, true);
});

test("exit and error frames stop the run and record the error", () => {
  const base = { output: ["a"], error: undefined, running: true };
  assert.equal(isTerminalFrame({ type: "exit", code: 0 }), true);
  assert.equal(
    isTerminalFrame({ type: "error", code: "boom", message: "it broke" }),
    true,
  );
  assert.equal(isTerminalFrame({ type: "stdout", data: "x" }), false);
  assert.equal(isTerminalFrame({ type: "keepalive" }), false);
  const exited = applyTerminalFrame(base, { type: "exit", code: 2 });
  assert.equal(exited.running, false);
  assert.equal(exited.error, undefined);
  const failed = applyTerminalFrame(base, {
    type: "error",
    code: "boom",
    message: "it broke",
  });
  assert.equal(failed.running, false);
  assert.equal(failed.error, "it broke");
});

test("keeps the state untouched for non-terminal frames", () => {
  const base = { output: ["a"], error: undefined, running: true };
  assert.equal(applyTerminalFrame(base, { type: "keepalive" }), base);
  assert.equal(
    applyTerminalFrame(base, { type: "resize", rows: 24, columns: 80 }),
    base,
  );
});

test("maps request failures to displayable messages", () => {
  assert.equal(
    requestErrorMessage(new Error("socket closed")),
    "socket closed",
  );
  assert.equal(
    requestErrorMessage(undefined),
    "Could not create a terminal session.",
  );
});

test("reports the error message for error frames and the generic fallback otherwise", () => {
  assert.equal(
    terminalFrameErrorMessage({
      type: "error",
      code: "boom",
      message: "it broke",
    }),
    "it broke",
  );
  assert.equal(
    terminalFrameErrorMessage({ type: "exit", code: 1 }),
    "The terminal returned an invalid frame.",
  );
});

test("only allows running a command for an online host with a target container", () => {
  const base = {
    host: { id: "h1", status: "online" },
    containerId: "c1",
    command: "ls",
    running: false,
  };
  assert.equal(canRunTerminalCommand(base), true);
  assert.equal(canRunTerminalCommand({ ...base, host: undefined }), false);
  assert.equal(canRunTerminalCommand({ ...base, host: {} }), false);
  assert.equal(
    canRunTerminalCommand({ ...base, host: { id: "h1", status: "offline" } }),
    false,
  );
  assert.equal(
    canRunTerminalCommand({ ...base, containerId: undefined }),
    false,
  );
  assert.equal(canRunTerminalCommand({ ...base, command: "   " }), false);
  assert.equal(canRunTerminalCommand({ ...base, running: true }), false);
});
