#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  runServerInstaller,
  serverInstallerAiContext,
  serverInstallerUsage,
} from "./server-installer.mjs";

const sourceUrl = "https://github.com/turin-dev/harbor-desk";
const releasesUrl = `${sourceUrl}/releases`;
const installGuideUrl = `${sourceUrl}/blob/main/README.md#npm-server-setup`;

function usage() {
  return [
    "Harbor Desk server setup",
    "",
    "Usage:",
    "  npm exec --yes harbor-desk",
    "  npm exec --yes harbor-desk -- install",
    "  npm exec --yes harbor-desk -- install-server",
    "  npm exec --yes harbor-desk -- --open-release",
    "  npm exec --yes harbor-desk -- --open-source",
    "  npm exec --yes harbor-desk -- --version",
    "  npm exec --yes harbor-desk -- -AI",
    "  npm exec --yes harbor-desk -- install-server --directory /srv/harbor-desk-preview --allow-local-engine-socket",
    "",
    "Run the default command from an interactive SSH session to open the keyboard-driven",
    "server setup wizard. It detects the local Docker socket, validates the connection,",
    "and prints the SSH tunnel or Gateway connection information when installation finishes.",
    "Use explicit install-server options for CI and other non-interactive environments.",
    "",
    `Source: ${sourceUrl}`,
    `Releases: ${releasesUrl}`,
    `Server-side setup: ${installGuideUrl}`,
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

if (argument === "install" || argument === "install-server" || !argument) {
  try {
    await runServerInstaller(extraArguments);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const interactiveSetup =
      extraArguments.length === 0 &&
      process.stdin.isTTY &&
      process.stdout.isTTY;
    if (interactiveSetup || message.startsWith("Setup cancelled;")) {
      process.stderr.write(`${message}\n`);
      process.exitCode = message.startsWith("Setup cancelled;") ? 130 : 1;
    } else {
      process.stderr.write(`${message}\n\n${serverInstallerUsage()}\n`);
      process.exitCode = 1;
    }
  }
} else if (extraArguments.length > 0) {
  process.stderr.write(
    `Unexpected arguments: ${process.argv.slice(2).join(" ")}\n\n`,
  );
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 1;
} else if (argument === "--help" || argument === "-h") {
  process.stdout.write(`${usage()}\n`);
} else if (argument === "--version" || argument === "-v") {
  process.stdout.write(`${await packageVersion()}\n`);
} else if (argument === "-AI" || argument === "--ai-context") {
  process.stdout.write(`${serverInstallerAiContext()}\n`);
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
