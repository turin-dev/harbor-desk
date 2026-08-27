#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  runServerInstaller,
  serverInstallerUsage,
} from "./server-installer.mjs";

const sourceUrl = "https://github.com/turin-dev/harbor-desk";
const releasesUrl = `${sourceUrl}/releases`;
const installGuideUrl = `${sourceUrl}/blob/main/README.md#server-local-engine-overlay`;

function usage() {
  return [
    "Harbor Desk npx bootstrap",
    "",
    "Usage:",
    "  npx --yes harbor-desk",
    "  npx --yes harbor-desk --open-release",
    "  npx --yes harbor-desk --open-source",
    "  npx --yes harbor-desk --version",
    "  npx --yes harbor-desk install-server --directory /srv/harbor-desk-preview --allow-local-engine-socket",
    "",
    "This bootstrap command does not install or launch the Electron desktop app.",
    "It does not access Docker Desktop, a local Docker socket, Docker CLI, or a Docker daemon.",
    "The explicit install-server command installs a loopback-only preview gateway on a Linux Docker host.",
    "",
    `Source: ${sourceUrl}`,
    `Releases: ${releasesUrl}`,
    `Private server-side setup: ${installGuideUrl}`,
  ].join("\n");
}

async function packageVersion() {
  const manifestUrl = new URL("../package.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  return manifest.version;
}

function openUrl(url) {
  const command =
    process.platform === "win32"
      ? "cmd.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["/d", "/s", "/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });

  child.once("error", () => {
    process.stderr.write(`Could not open a browser. Visit ${url}\n`);
  });
  child.unref();
}

const [argument, ...extraArguments] = process.argv.slice(2);

if (argument === "install-server") {
  try {
    await runServerInstaller(extraArguments);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n\n${serverInstallerUsage()}\n`);
    process.exitCode = 1;
  }
} else if (extraArguments.length > 0) {
  process.stderr.write(
    `Unexpected arguments: ${process.argv.slice(2).join(" ")}\n\n`,
  );
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 1;
} else if (!argument || argument === "--help" || argument === "-h") {
  process.stdout.write(`${usage()}\n`);
} else if (argument === "--version" || argument === "-v") {
  process.stdout.write(`${await packageVersion()}\n`);
} else if (argument === "--open-release") {
  process.stdout.write(`Opening release page: ${releasesUrl}\n`);
  openUrl(releasesUrl);
} else if (argument === "--open-source") {
  process.stdout.write(`Opening source repository: ${sourceUrl}\n`);
  openUrl(sourceUrl);
} else {
  process.stderr.write(`Unknown argument: ${argument}\n\n`);
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 1;
}
