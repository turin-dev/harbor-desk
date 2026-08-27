import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  buildServerInstallPlan,
  parseServerInstallArgs,
  serverInstallerPayload,
  serverInstallerUsage,
} from "../bin/server-installer.mjs";

const cliPath = fileURLToPath(
  new URL("../bin/harbor-desk.mjs", import.meta.url),
);
const manifestUrl = new URL("../package.json", import.meta.url);
const packageRoot = resolve(dirname(cliPath), "..");

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
  assert.match(result.stdout, /install-server --directory/);
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

test("documents the explicit preview server installer without hiding socket risk", () => {
  const result = runCli("install-server", "--help");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /controlled Linux server/);
  assert.match(result.stdout, /--allow-local-engine-socket/);
  assert.match(result.stdout, /refuses non-empty directories or busy ports/);
  assert.match(serverInstallerUsage(), /Docker socket/);
});

test("parses an isolated server install plan and keeps it loopback-only", () => {
  const cwd = process.cwd();
  const options = parseServerInstallArgs(
    [
      "--directory",
      "./server-install",
      "--port",
      "4312",
      "--engine-name",
      "controlled local Docker Engine",
      "--allow-local-engine-socket",
      "--dry-run",
    ],
    { cwd },
  );
  const plan = buildServerInstallPlan(options, {
    root: cwd,
    version: "0.2.0-test",
  });

  assert.equal(options.directory, resolve(cwd, "server-install"));
  assert.equal(options.port, 4312);
  assert.equal(options.allowLocalEngineSocket, true);
  assert.equal(plan.healthUrl, "http://127.0.0.1:4312/health/live");
  assert.match(plan.environmentFile, /\.harbor-desk\.env$/);
  assert.ok(
    serverInstallerPayload.payloadPaths.includes(
      "server-payload/source/infra/compose",
    ),
    "the npm package must carry the Compose payload needed by install-server",
  );
});

test("requires an explicit destination and rejects malformed server options", () => {
  assert.throws(
    () => parseServerInstallArgs(["--allow-local-engine-socket"]),
    /--directory is required/,
  );
  assert.throws(
    () =>
      parseServerInstallArgs([
        "--directory",
        "./server-install",
        "--port",
        "70000",
      ]),
    /between 1 and 65535/,
  );
  assert.throws(
    () =>
      parseServerInstallArgs(["--directory", "./server-install", "--unknown"]),
    /Unknown install-server option: --unknown/,
  );
});

test("packs a minimal reproducible server payload for install-server", () => {
  const command =
    process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const arguments_ =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npm.cmd pack --dry-run --json"]
      : ["pack", "--dry-run", "--json"];
  const result = spawnSync(command, arguments_, {
    cwd: packageRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const [pack] = JSON.parse(result.stdout);
  const paths = new Set(pack.files.map((entry) => entry.path));
  const expected = [
    "bin/harbor-desk.mjs",
    "bin/server-installer.mjs",
    "server-payload/source/apps/gateway/src/server.ts",
    "server-payload/source/infra/compose/Dockerfile.gateway",
    "server-payload/source/pnpm-lock.yaml.txt",
  ];

  for (const path of expected) {
    assert.ok(paths.has(path), `missing ${path} from npm package`);
  }

  for (const path of paths) {
    assert.doesNotMatch(path, /(^|\/)(node_modules|dist)(\/|$)/);
    assert.doesNotMatch(path, /\.test\.(?:[cm]?[jt]s|tsx)$/);
  }

  assert.equal(
    existsSync(resolve(packageRoot, "server-payload")),
    false,
    "postpack must remove the generated payload from the source checkout",
  );
});
