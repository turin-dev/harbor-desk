import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultPort = 4311;
const defaultEngineSocket = "/var/run/docker.sock";
const defaultProjectName = "harbor-desk-server";
const defaultEngineName = "Server local Docker Engine";

// The gateway container always receives the Engine socket at this path, because
// the local-engine Compose overlay pins the bind target. The Engine endpoint the
// gateway dials is therefore this container path, never the host-side source.
const containerEngineSocket = "/var/run/docker.sock";

// Docker Desktop hosts resolve the "/var/run/docker.sock" bind source inside
// their own Linux VM rather than on the host filesystem, so the same Compose
// source works on Windows and macOS. Only a native Linux Engine exposes the
// socket as a host filesystem entry that can be inspected before starting.
const supportedPlatforms = new Map([
  ["linux", { label: "Linux", hostSocketIsFile: true, canSudo: true }],
  ["win32", { label: "Windows", hostSocketIsFile: false, canSudo: false }],
  ["darwin", { label: "macOS", hostSocketIsFile: false, canSudo: true }],
]);

export function serverPlatformSupport(platform = process.platform) {
  return supportedPlatforms.get(platform);
}

const payloadEntries = [
  {
    source: "server-payload/source/package.json",
    destination: "package.json",
  },
  {
    source: "server-payload/source/pnpm-lock.yaml.txt",
    destination: "pnpm-lock.yaml",
  },
  {
    source: "server-payload/source/pnpm-workspace.yaml",
    destination: "pnpm-workspace.yaml",
  },
  {
    source: "server-payload/source/tsconfig.base.json",
    destination: "tsconfig.base.json",
  },
  { source: "server-payload/source/apps/gateway", destination: "apps/gateway" },
  {
    source: "server-payload/source/packages/config",
    destination: "packages/config",
  },
  {
    source: "server-payload/source/packages/connectors",
    destination: "packages/connectors",
  },
  {
    source: "server-payload/source/packages/contracts",
    destination: "packages/contracts",
  },
  {
    source: "server-payload/source/infra/compose",
    destination: "infra/compose",
  },
  { source: "server-payload/source/LICENSE", destination: "LICENSE" },
];

export class ServerInstallerError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ServerInstallerError";
  }
}

function optionValue(arguments_, index, option) {
  const value = arguments_[index + 1];

  if (!value || value.startsWith("--")) {
    throw new ServerInstallerError(`${option} requires a value.`);
  }

  return value;
}

function parsePort(value) {
  if (!/^\d+$/.test(value)) {
    throw new ServerInstallerError(
      "--port must be an integer between 1 and 65535.",
    );
  }

  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new ServerInstallerError(
      "--port must be an integer between 1 and 65535.",
    );
  }

  return port;
}

function safeEnvironmentValue(value, option) {
  if (!value || /[\0\r\n]/.test(value)) {
    throw new ServerInstallerError(
      `${option} must be a non-empty single-line value.`,
    );
  }

  return value;
}

function validateProjectName(projectName) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(projectName)) {
    throw new ServerInstallerError(
      "--project-name must start with a letter or number and use only letters, numbers, underscores, or hyphens.",
    );
  }

  return projectName.toLowerCase();
}

// The Compose bind source is interpreted by the Docker Engine, not by the shell
// that runs the installer. On a Docker Desktop host the Engine resolves it inside
// its own Linux VM, so it must stay a POSIX path and must never be run through
// Windows path resolution, which would rewrite it to a drive-letter path.
function normalizeEngineSocket(value, platform, cwd) {
  const socket = safeEnvironmentValue(value, "--engine-socket");
  const support = supportedPlatforms.get(platform);

  if (!socket.startsWith("/")) {
    if (support?.hostSocketIsFile) {
      return resolve(cwd, socket);
    }

    throw new ServerInstallerError(
      "--engine-socket must be an absolute Engine-side socket path such as /var/run/docker.sock.",
    );
  }

  return socket;
}

function validateInstallDirectory(directory, cwd) {
  if (!directory) {
    throw new ServerInstallerError(
      "--directory is required so the installer never guesses or overwrites a server path.",
    );
  }

  const resolved = resolve(cwd, directory);
  if (dirname(resolved) === resolved) {
    throw new ServerInstallerError(
      "Refusing to use a filesystem root as --directory.",
    );
  }

  return resolved;
}

export function parseServerInstallArgs(
  arguments_,
  { cwd = process.cwd(), platform = process.platform } = {},
) {
  const options = {
    directory: undefined,
    port: defaultPort,
    engineSocket: defaultEngineSocket,
    engineName: defaultEngineName,
    projectName: defaultProjectName,
    allowLocalEngineSocket: false,
    dryRun: false,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];

    switch (argument) {
      case "--directory":
        options.directory = optionValue(arguments_, index, argument);
        index += 1;
        break;
      case "--port":
        options.port = parsePort(optionValue(arguments_, index, argument));
        index += 1;
        break;
      case "--engine-socket":
        options.engineSocket = optionValue(arguments_, index, argument);
        index += 1;
        break;
      case "--engine-name":
        options.engineName = optionValue(arguments_, index, argument);
        index += 1;
        break;
      case "--project-name":
        options.projectName = optionValue(arguments_, index, argument);
        index += 1;
        break;
      case "--allow-local-engine-socket":
        options.allowLocalEngineSocket = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        throw new ServerInstallerError(
          `Unknown install-server option: ${argument}`,
        );
    }
  }

  return {
    ...options,
    platform,
    directory: validateInstallDirectory(options.directory, cwd),
    engineSocket: normalizeEngineSocket(options.engineSocket, platform, cwd),
    engineName: safeEnvironmentValue(options.engineName, "--engine-name"),
    projectName: validateProjectName(options.projectName),
  };
}

export function serverInstallerUsage() {
  return [
    "Install the Harbor Desk preview gateway on a controlled Linux, Windows, or macOS Docker host.",
    "",
    "Usage:",
    "  npx --yes harbor-desk install-server --directory /srv/harbor-desk-preview --allow-local-engine-socket",
    "",
    "Options:",
    "  --directory <path>              Required empty destination directory.",
    `  --port <number>                 Loopback gateway port (default: ${defaultPort}).`,
    `  --engine-socket <path>          Engine-side Docker socket to mount (default: ${defaultEngineSocket}).`,
    `  --engine-name <name>            Display name for the server Engine (default: ${defaultEngineName}).`,
    `  --project-name <name>           Docker Compose project (default: ${defaultProjectName}).`,
    "  --allow-local-engine-socket      Required acknowledgement before mounting the Docker socket.",
    "  --dry-run                       Validate the host and print the plan without writing or starting containers.",
    "",
    "On Docker Desktop the socket path is resolved by the Engine inside its own Linux VM,",
    "so it stays a POSIX path on Windows and macOS as well as on a native Linux Engine.",
    "",
    "The installer creates a loopback-only development preview gateway. A Docker socket",
    "is highly privileged even when its bind mount is marked read-only. This is not a",
    "production deployment command and it refuses non-empty directories or busy ports.",
  ].join("\n");
}

async function readPackageVersion(root) {
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  return manifest.version;
}

export function buildServerInstallPlan(
  options,
  { root = packageRoot, version = "unknown", platform } = {},
) {
  return {
    ...options,
    root,
    version,
    platform: platform ?? options.platform ?? process.platform,
    environmentFile: join(options.directory, ".harbor-desk.env"),
    markerFile: join(options.directory, ".harbor-desk-server-install.json"),
    composeFiles: [
      join(options.directory, "infra", "compose", "docker-compose.preview.yml"),
      join(
        options.directory,
        "infra",
        "compose",
        "docker-compose.preview.local-engine.yml",
      ),
    ],
    healthUrl: `http://127.0.0.1:${options.port}/health/live`,
  };
}

async function assertPayloadExists(root) {
  for (const { source: relativePath } of payloadEntries) {
    try {
      await lstat(join(root, relativePath));
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        throw new ServerInstallerError(
          `This npm package does not include the server payload (${relativePath}). Install a current harbor-desk release.`,
        );
      }
      throw error;
    }
  }
}

async function assertEmptyTarget(directory) {
  try {
    const target = await lstat(directory);
    if (!target.isDirectory() || target.isSymbolicLink()) {
      throw new ServerInstallerError(
        `Refusing to use ${directory} because --directory must be a real empty directory, not a file or symbolic link.`,
      );
    }
    const entries = await readdir(directory);
    if (entries.length > 0) {
      throw new ServerInstallerError(
        `Refusing to overwrite the non-empty directory ${directory}. Choose a new directory instead.`,
      );
    }
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function assertSocket(socketPath, platform) {
  // Only a native Linux Engine exposes the socket as a host filesystem entry.
  // On Docker Desktop the bind source is resolved inside the Engine VM, so there
  // is nothing to stat here; Compose reports an invalid source when it starts.
  if (!supportedPlatforms.get(platform)?.hostSocketIsFile) {
    return;
  }

  let socket;
  try {
    socket = await lstat(socketPath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw new ServerInstallerError(
        `Docker socket not found at ${socketPath}.`,
      );
    }
    throw error;
  }

  if (!socket.isSocket()) {
    throw new ServerInstallerError(`${socketPath} is not a Unix socket.`);
  }
}

export async function assertLoopbackPortAvailable(port) {
  await new Promise((resolvePromise, reject) => {
    const listener = net.createServer();
    let settled = false;

    const finish = (callback) => {
      if (!settled) {
        settled = true;
        callback();
      }
    };

    listener.once("error", (error) => {
      finish(() => {
        if (error.code === "EADDRINUSE") {
          reject(
            new ServerInstallerError(
              `127.0.0.1:${port} is already in use. The installer will not replace an existing gateway or service.`,
            ),
          );
          return;
        }
        reject(error);
      });
    });

    listener.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      listener.close((error) => {
        finish(() => (error ? reject(error) : resolvePromise()));
      });
    });
  });
}

export function runCommand(
  command,
  arguments_,
  { cwd, stdio = "inherit" } = {},
) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      stdio,
      windowsHide: true,
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(
        new ServerInstallerError(
          `${command} ${arguments_.join(" ")} failed${signal ? ` (${signal})` : ` with exit code ${code}`}.`,
        ),
      );
    });
  });
}

async function resolveDockerRunner(run, platform) {
  try {
    await run("docker", ["compose", "version"], { stdio: "ignore" });
    return { command: "docker", prefix: [] };
  } catch {
    // Windows has no sudo, so a failed probe there is a real error rather than
    // a permissions issue that elevation could resolve.
    if (!supportedPlatforms.get(platform)?.canSudo) {
      throw new ServerInstallerError(
        "Docker Compose is unavailable to this account. Start Docker Desktop or install Docker Compose before retrying.",
      );
    }

    try {
      await run("sudo", ["-n", "docker", "compose", "version"], {
        stdio: "ignore",
      });
      return { command: "sudo", prefix: ["-n", "docker"] };
    } catch {
      throw new ServerInstallerError(
        "Docker Compose is unavailable to this account. Install Docker Compose or grant non-interactive Docker access before retrying.",
      );
    }
  }
}

async function copyServerPayload(plan) {
  for (const {
    source: relativeSource,
    destination: relativeDestination,
  } of payloadEntries) {
    const source = join(plan.root, relativeSource);
    const destination = join(plan.directory, relativeDestination);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    });
  }
}

async function writeServerEnvironment(plan, randomBytesFn) {
  const secret = randomBytesFn(32).toString("base64");
  const lines = [
    `SECRET_MASTER_KEY=${secret}`,
    // The gateway dials the socket at its in-container path, which the overlay
    // pins, so this stays correct even when the host-side source differs.
    `DEV_ENGINE_HOST=unix://${containerEngineSocket}`,
    `DEV_ENGINE_DISPLAY_NAME=${JSON.stringify(plan.engineName)}`,
    `DOCKER_SOCKET_PATH=${plan.engineSocket}`,
    `HARBOR_GATEWAY_PORT=${plan.port}`,
    `GATEWAY_VERSION=${plan.version}`,
  ];

  await writeFile(plan.environmentFile, `${lines.join("\n")}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

async function writeInstallMarker(plan) {
  const marker = {
    schemaVersion: 1,
    installedAt: new Date().toISOString(),
    packageVersion: plan.version,
    projectName: plan.projectName,
    loopbackPort: plan.port,
    engineSocket: plan.engineSocket,
  };

  await writeFile(plan.markerFile, `${JSON.stringify(marker, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o644,
  });
}

function composeArguments(plan, runner, trailingArguments) {
  return [
    ...runner.prefix,
    "compose",
    "--project-name",
    plan.projectName,
    "--env-file",
    plan.environmentFile,
    "-f",
    plan.composeFiles[0],
    "-f",
    plan.composeFiles[1],
    ...trailingArguments,
  ];
}

async function waitForGatewayHealth(
  url,
  {
    fetchImpl = globalThis.fetch,
    sleep = (milliseconds) =>
      new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
    timeoutMs = 120_000,
  } = {},
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) {
        return;
      }
    } catch {
      // The container may still be building or starting; retry until the deadline.
    }

    await sleep(2_000);
  }

  throw new ServerInstallerError(
    `Gateway did not become healthy at ${url}. The created files and Compose logs were preserved for inspection.`,
  );
}

export function formatServerInstallPlan(plan) {
  return [
    "Harbor Desk preview gateway install plan",
    `  Host platform: ${supportedPlatforms.get(plan.platform)?.label ?? plan.platform}`,
    `  Directory: ${plan.directory}`,
    `  Compose project: ${plan.projectName}`,
    `  Gateway: ${plan.healthUrl} (loopback only)`,
    `  Docker socket: ${plan.engineSocket}`,
    `  Server Engine name: ${plan.engineName}`,
  ].join("\n");
}

export async function installServer(
  options,
  {
    root = packageRoot,
    platform = options.platform ?? process.platform,
    version,
    run = runCommand,
    randomBytesFn = randomBytes,
    waitForHealth = waitForGatewayHealth,
  } = {},
) {
  if (!supportedPlatforms.has(platform)) {
    throw new ServerInstallerError(
      `install-server supports a controlled Docker host on ${[...supportedPlatforms.values()].map((entry) => entry.label).join(", ")}. This host reports "${platform}".`,
    );
  }

  if (!options.allowLocalEngineSocket) {
    throw new ServerInstallerError(
      "Refusing to mount a Docker socket without --allow-local-engine-socket. That socket grants highly privileged control of the server.",
    );
  }

  const packageVersion = version ?? (await readPackageVersion(root));
  const plan = buildServerInstallPlan(options, {
    root,
    version: packageVersion,
    platform,
  });

  await assertPayloadExists(plan.root);
  await assertEmptyTarget(plan.directory);
  await assertSocket(plan.engineSocket, platform);
  await assertLoopbackPortAvailable(plan.port);
  const runner = await resolveDockerRunner(run, platform);

  if (plan.dryRun) {
    return { plan, installed: false };
  }

  await mkdir(plan.directory, { recursive: true, mode: 0o750 });
  await copyServerPayload(plan);
  await writeServerEnvironment(plan, randomBytesFn);
  await writeInstallMarker(plan);

  await run(
    runner.command,
    composeArguments(plan, runner, ["config", "--quiet"]),
    { cwd: plan.directory },
  );
  await run(
    runner.command,
    composeArguments(plan, runner, ["up", "--detach", "--build"]),
    { cwd: plan.directory },
  );
  await waitForHealth(plan.healthUrl);

  return { plan, installed: true };
}

export async function runServerInstaller(
  arguments_,
  { cwd = process.cwd(), stdout = process.stdout, ...dependencies } = {},
) {
  if (arguments_.length === 1 && ["--help", "-h"].includes(arguments_[0])) {
    stdout.write(`${serverInstallerUsage()}\n`);
    return { help: true };
  }

  const options = parseServerInstallArgs(arguments_, { cwd });
  const result = await installServer(options, dependencies);
  stdout.write(`${formatServerInstallPlan(result.plan)}\n`);

  if (result.installed) {
    stdout.write(
      `Installed Harbor Desk preview gateway. Health: ${result.plan.healthUrl}\n`,
    );
  } else {
    stdout.write("Dry run passed. No files or containers were changed.\n");
  }

  return result;
}

export const serverInstallerPayload = Object.freeze({
  defaultEngineSocket,
  defaultPort,
  defaultProjectName,
  payloadPaths: payloadEntries.map(({ source }) => source),
});
