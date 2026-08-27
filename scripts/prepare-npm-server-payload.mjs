import { cp, mkdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const payloadDirectory = join(repositoryRoot, "server-payload");
const sourceDirectory = join(payloadDirectory, "source");

const payloadEntries = [
  ["package.json", "package.json"],
  ["pnpm-lock.yaml", "pnpm-lock.yaml.txt"],
  ["pnpm-workspace.yaml", "pnpm-workspace.yaml"],
  ["tsconfig.base.json", "tsconfig.base.json"],
  ["apps/gateway", "apps/gateway"],
  ["packages/config", "packages/config"],
  ["packages/connectors", "packages/connectors"],
  ["packages/contracts", "packages/contracts"],
  ["infra/compose", "infra/compose"],
  ["LICENSE", "LICENSE"],
];

function shouldInclude(source) {
  const name = basename(source);
  return (
    !["node_modules", "dist", ".git"].includes(name) &&
    !/\.test\.(?:[cm]?[jt]s|tsx)$/.test(name)
  );
}

if (process.argv.includes("--clean")) {
  await rm(payloadDirectory, { recursive: true, force: true });
} else {
  await rm(payloadDirectory, { recursive: true, force: true });
  await mkdir(sourceDirectory, { recursive: true });

  for (const [source, destination] of payloadEntries) {
    await cp(join(repositoryRoot, source), join(sourceDirectory, destination), {
      recursive: true,
      filter: shouldInclude,
      preserveTimestamps: true,
    });
  }
}
