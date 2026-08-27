import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const cliPath = fileURLToPath(
  new URL("../bin/harbor-desk.mjs", import.meta.url),
);
const manifestUrl = new URL("../package.json", import.meta.url);

function runCli(...arguments_) {
  return spawnSync(process.execPath, [cliPath, ...arguments_], {
    encoding: "utf8",
  });
}

test("prints the safe npx bootstrap contract by default", () => {
  const result = runCli();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Harbor Desk npx bootstrap/);
  assert.match(
    result.stdout,
    /does not access Docker Desktop, a local Docker socket/,
  );
  assert.match(
    result.stdout,
    /https:\/\/github\.com\/turin-dev\/harbor-desk\/releases/,
  );
});

test("reports the package manifest version", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const result = runCli("--version");

  assert.equal(manifest.bin?.["harbor-desk"], "bin/harbor-desk.mjs");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), manifest.version);
});

test("rejects unknown arguments without performing an action", () => {
  const result = runCli("--not-a-command");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown argument: --not-a-command/);
  assert.match(result.stderr, /Harbor Desk npx bootstrap/);
});
