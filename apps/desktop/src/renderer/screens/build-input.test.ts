import test from "node:test";
import assert from "node:assert/strict";
import { describeBuildResult, parseBuildForm } from "./build-input.js";

test("parses a tag, dockerfile path, and build arg lines", () => {
  const result = parseBuildForm({
    tag: "  registry.example.com/team/app:1.0  ",
    dockerfile: "  sub/Dockerfile.test ",
    buildArgsLines: "MODE=release\n# a comment\n\nPADDED=  ",
  });
  assert.equal(result.issue, undefined);
  assert.deepEqual(result.value, {
    tag: "registry.example.com/team/app:1.0",
    dockerfile: "sub/Dockerfile.test",
    buildArgs: { MODE: "release", PADDED: "" },
  });
});

test("accepts digest-pinned tags", () => {
  const digest = "app@sha256:" + "a".repeat(64);
  const result = parseBuildForm({ tag: digest });
  assert.equal(result.issue, undefined);
  assert.equal(result.value?.tag, digest);
});

test("rejects missing, malformed, and oversized tags", () => {
  assert.equal(parseBuildForm({ tag: "  " }).issue?.field, "tag");
  assert.equal(parseBuildForm({ tag: ":no-name" }).issue?.field, "tag");
  assert.equal(parseBuildForm({ tag: "UPPER" }).issue?.field, "tag");
  assert.equal(parseBuildForm({ tag: "x".repeat(513) }).issue?.field, "tag");
});

test("rejects absolute and backslash dockerfile paths", () => {
  assert.equal(
    parseBuildForm({ tag: "app:dev", dockerfile: "/Dockerfile" }).issue?.field,
    "dockerfile",
  );
  assert.equal(
    parseBuildForm({
      tag: "app:dev",
      dockerfile: "sub\\Dockerfile",
    }).issue?.field,
    "dockerfile",
  );
});

test("rejects malformed build arg lines", () => {
  assert.equal(
    parseBuildForm({ tag: "app:dev", buildArgsLines: "NOEQUALS" }).issue?.field,
    "buildArgs",
  );
  assert.equal(
    parseBuildForm({ tag: "app:dev", buildArgsLines: "9BAD=x" }).issue?.field,
    "buildArgs",
  );
  assert.equal(
    parseBuildForm({
      tag: "app:dev",
      buildArgsLines: "KEY=" + "v".repeat(256),
    }).issue?.field,
    "buildArgs",
  );
});

test("describes terminal build operations", () => {
  assert.equal(describeBuildResult(undefined, "app:dev"), undefined);
  assert.deepEqual(describeBuildResult({ status: "succeeded" }, "app:dev"), {
    tone: "success",
    title: "Build finished",
    body: "The image tagged app:dev was built on the remote host.",
  });
  assert.deepEqual(describeBuildResult({ status: "cancelled" }, "app:dev"), {
    tone: "info",
    title: "Build cancelled",
    body: "The remote build was cancelled before it finished.",
  });
  const failed = describeBuildResult(
    { status: "failed", message: "step 3: exit code 1" },
    "app:dev",
  );
  assert.equal(failed?.tone, "error");
  assert.equal(failed?.body, "step 3: exit code 1");
});
