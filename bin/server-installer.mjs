import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import { emitKeypressEvents } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultPort = 4311;
const defaultEngineSocket = "/var/run/docker.sock";
const defaultProjectName = "harbor-desk-server";
const defaultEngineName = "Server local Docker Engine";
const defaultBindHost = "127.0.0.1";
const defaultAuthMode = "dev";
const defaultInstallDirectoryName = "harbor-desk-server";
const defaultAllowedOrigins = Object.freeze([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

// The gateway container always receives the Engine socket at this path, because
// the local-engine Compose overlay pins the bind target. The Engine endpoint the
// gateway dials is therefore this container path, never the host-side source.
const containerEngineSocket = "/var/run/docker.sock";
const containerEngineTlsDirectory = "/run/harbor-desk/engine";
const containerEngineCaFile = `${containerEngineTlsDirectory}/ca.pem`;
const containerEngineCertFile = `${containerEngineTlsDirectory}/client-cert.pem`;
const containerEngineKeyFile = `${containerEngineTlsDirectory}/client-key.pem`;

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

function parseBindHost(value) {
  const bindHost = safeEnvironmentValue(value, "--bind-host");
  if (bindHost !== "127.0.0.1" && bindHost !== "0.0.0.0") {
    throw new ServerInstallerError(
      "--bind-host currently accepts only 127.0.0.1 or 0.0.0.0.",
    );
  }
  return bindHost;
}

function parseAuthMode(value) {
  if (value !== "dev" && value !== "oidc") {
    throw new ServerInstallerError("--auth-mode must be either dev or oidc.");
  }
  return value;
}

function parseAllowedOrigin(value) {
  const origin = safeEnvironmentValue(value, "--allowed-origin");
  if (origin === "null") return origin;
  let parsed;

  try {
    parsed = new URL(origin);
  } catch {
    throw new ServerInstallerError(
      "--allowed-origin must be an http or https origin without a path, query, or fragment.",
    );
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ServerInstallerError(
      "--allowed-origin must be an http or https origin without a path, query, or fragment.",
    );
  }

  return parsed.origin;
}

function parseAllowedOrigins(value) {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(parseAllowedOrigin);
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

function normalizeEngineEndpoint(value) {
  const endpoint = safeEnvironmentValue(value, "--engine-endpoint");
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new ServerInstallerError(
      "--engine-endpoint must be a valid HTTPS Docker Engine URL.",
    );
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ServerInstallerError(
      "--engine-endpoint must use HTTPS without credentials, query parameters, or a fragment.",
    );
  }

  return endpoint;
}

function normalizeEngineTlsFile(value, option, cwd) {
  return resolve(cwd, safeEnvironmentValue(value, option));
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

function validateServerInstallOptions(options) {
  const bindHost = options.bindHost ?? defaultBindHost;
  const authMode = options.authMode ?? defaultAuthMode;

  if (bindHost !== "127.0.0.1" && bindHost !== "0.0.0.0") {
    throw new ServerInstallerError(
      "--bind-host currently accepts only 127.0.0.1 or 0.0.0.0.",
    );
  }
  if (authMode !== "dev" && authMode !== "oidc") {
    throw new ServerInstallerError("--auth-mode must be either dev or oidc.");
  }

  if (options.aiContext) return;

  const engineTlsFiles = [
    options.engineCaFile,
    options.engineCertFile,
    options.engineKeyFile,
  ];
  const hasEngineTlsMaterial = engineTlsFiles.some(Boolean);
  if (options.engineEndpoint) {
    if (options.engineSocketExplicit || options.allowLocalEngineSocket) {
      throw new ServerInstallerError(
        "--engine-endpoint cannot be combined with --engine-socket or --allow-local-engine-socket; choose one Engine transport.",
      );
    }
    if (!engineTlsFiles.every(Boolean)) {
      throw new ServerInstallerError(
        "--engine-endpoint requires --engine-ca-file, --engine-cert-file, and --engine-key-file for server-side mTLS.",
      );
    }
  } else if (hasEngineTlsMaterial) {
    throw new ServerInstallerError(
      "--engine-ca-file, --engine-cert-file, and --engine-key-file require --engine-endpoint.",
    );
  }

  if (bindHost === "0.0.0.0" && authMode !== "oidc") {
    throw new ServerInstallerError(
      "Public binding (--bind-host 0.0.0.0/--public) requires --auth-mode oidc; development authentication cannot be exposed on a network.",
    );
  }
  if (bindHost === "0.0.0.0" && options.allowedOrigins.includes("null")) {
    throw new ServerInstallerError(
      "Public binding cannot use the opaque packaged-desktop origin `null`; configure an explicit HTTPS client origin.",
    );
  }

  if (authMode === "oidc" && !options.oidcProvidersFile) {
    throw new ServerInstallerError(
      "--auth-mode oidc requires --oidc-providers-file with at least one provider.",
    );
  }

  if (authMode === "dev" && options.oidcProvidersFile) {
    throw new ServerInstallerError(
      "--oidc-providers-file can only be used with --auth-mode oidc.",
    );
  }
}

export function parseServerInstallArgs(
  arguments_,
  { cwd = process.cwd(), platform = process.platform } = {},
) {
  const options = {
    directory: undefined,
    port: defaultPort,
    bindHost: defaultBindHost,
    engineSocket: defaultEngineSocket,
    engineSocketExplicit: false,
    engineEndpoint: undefined,
    engineCaFile: undefined,
    engineCertFile: undefined,
    engineKeyFile: undefined,
    engineName: defaultEngineName,
    projectName: defaultProjectName,
    authMode: defaultAuthMode,
    oidcProvidersFile: undefined,
    allowedOrigins: [...defaultAllowedOrigins],
    aiContext: false,
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
      case "--bind-host":
        options.bindHost = parseBindHost(
          optionValue(arguments_, index, argument),
        );
        index += 1;
        break;
      case "--public":
        options.bindHost = "0.0.0.0";
        break;
      case "-AI":
      case "--ai-context":
        options.aiContext = true;
        break;
      case "--engine-socket":
        options.engineSocket = optionValue(arguments_, index, argument);
        options.engineSocketExplicit = true;
        index += 1;
        break;
      case "--engine-endpoint":
        options.engineEndpoint = normalizeEngineEndpoint(
          optionValue(arguments_, index, argument),
        );
        index += 1;
        break;
      case "--engine-ca-file":
        options.engineCaFile = optionValue(arguments_, index, argument);
        index += 1;
        break;
      case "--engine-cert-file":
        options.engineCertFile = optionValue(arguments_, index, argument);
        index += 1;
        break;
      case "--engine-key-file":
        options.engineKeyFile = optionValue(arguments_, index, argument);
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
      case "--auth-mode":
        options.authMode = parseAuthMode(
          optionValue(arguments_, index, argument),
        );
        index += 1;
        break;
      case "--oidc-providers-file":
        options.oidcProvidersFile = optionValue(arguments_, index, argument);
        index += 1;
        break;
      case "--allowed-origin":
        options.allowedOrigins.push(
          ...parseAllowedOrigins(optionValue(arguments_, index, argument)),
        );
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

  validateServerInstallOptions(options);

  const { engineSocketExplicit, ...publicOptions } = options;
  return {
    ...publicOptions,
    platform,
    directory: options.aiContext
      ? options.directory
        ? validateInstallDirectory(options.directory, cwd)
        : undefined
      : validateInstallDirectory(options.directory, cwd),
    engineSocket: options.engineEndpoint
      ? undefined
      : normalizeEngineSocket(options.engineSocket, platform, cwd),
    engineCaFile: options.engineCaFile
      ? normalizeEngineTlsFile(options.engineCaFile, "--engine-ca-file", cwd)
      : undefined,
    engineCertFile: options.engineCertFile
      ? normalizeEngineTlsFile(
          options.engineCertFile,
          "--engine-cert-file",
          cwd,
        )
      : undefined,
    engineKeyFile: options.engineKeyFile
      ? normalizeEngineTlsFile(options.engineKeyFile, "--engine-key-file", cwd)
      : undefined,
    engineName: safeEnvironmentValue(options.engineName, "--engine-name"),
    projectName: validateProjectName(options.projectName),
    oidcProvidersFile: options.oidcProvidersFile
      ? resolve(
          cwd,
          safeEnvironmentValue(
            options.oidcProvidersFile,
            "--oidc-providers-file",
          ),
        )
      : undefined,
    allowedOrigins: [
      ...new Set([
        ...options.allowedOrigins.map(parseAllowedOrigin),
        ...(options.bindHost === "127.0.0.1" ? ["null"] : []),
      ]),
    ],
  };
}

export function serverInstallerUsage() {
  return [
    "Install the Harbor Desk preview gateway on a controlled Linux, Windows, or macOS Docker host.",
    "",
    "Usage:",
    "  npm exec --yes harbor-desk",
    "  npm exec --yes harbor-desk -- install",
    "  npm exec --yes harbor-desk -- install-server",
    "  npm exec --yes harbor-desk -- install-server --directory /srv/harbor-desk-preview --allow-local-engine-socket",
    "  npm exec --yes harbor-desk -- install-server -AI",
    "",
    "The first three forms open a keyboard-driven TUI when stdin and stdout are a TTY;",
    "run them from an interactive SSH session. They do not open a browser on the server.",
    "",
    "Options:",
    "  --directory <path>              Required empty destination directory.",
    `  --port <number>                 Gateway port (default: ${defaultPort}).`,
    "  --bind-host <host>              127.0.0.1 (default) or 0.0.0.0 for network access.",
    "  --public                        Shorthand for --bind-host 0.0.0.0.",
    `  --engine-socket <path>          Engine-side Docker socket to mount (default: ${defaultEngineSocket}).`,
    "  --engine-endpoint <url>         HTTPS Docker Engine endpoint for server-side mTLS instead of a socket.",
    "  --engine-ca-file <path>         CA certificate file for --engine-endpoint.",
    "  --engine-cert-file <path>       Client certificate file for --engine-endpoint.",
    "  --engine-key-file <path>        Client private key file for --engine-endpoint.",
    `  --engine-name <name>            Display name for the server Engine (default: ${defaultEngineName}).`,
    `  --project-name <name>           Docker Compose project (default: ${defaultProjectName}).`,
    "  --auth-mode <mode>              dev (local only) or oidc (required for public).",
    "  --oidc-providers-file <path>    JSON provider configuration for OIDC mode.",
    "  --allowed-origin <origin>       Additional browser origin; may be repeated.",
    "  -AI, --ai-context               Print machine-readable AI setup context and exit.",
    "  --allow-local-engine-socket      Required acknowledgement before mounting the Docker socket.",
    "  --dry-run                       Validate the host and print the plan without writing or starting containers.",
    "",
    "On Docker Desktop the socket path is resolved by the Engine inside its own Linux VM,",
    "so it stays a POSIX path on Windows and macOS as well as on a native Linux Engine.",
    "For a remote Engine, pass all three mTLS files; they are mounted read-only only",
    "inside the gateway container and are never copied into the client or printed.",
    "",
    "The installer creates a development preview gateway. Public binding requires OIDC",
    "and should still be placed behind TLS/reverse proxy and a firewall. A Docker socket",
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
  const bindHost = options.bindHost ?? defaultBindHost;
  const authMode = options.authMode ?? defaultAuthMode;

  return {
    ...options,
    bindHost,
    authMode,
    allowedOrigins: options.allowedOrigins ?? [
      ...defaultAllowedOrigins,
      ...(bindHost === "127.0.0.1" ? ["null"] : []),
    ],
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
        options.engineEndpoint
          ? "docker-compose.preview.remote-engine.yml"
          : "docker-compose.preview.local-engine.yml",
      ),
    ],
    engineMode: options.engineEndpoint ? "remote-mtls" : "local-socket",
    healthUrl: `http://127.0.0.1:${options.port}/health/live`,
  };
}

function providerString(provider, key, index, { required = true } = {}) {
  const value = provider[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim() || /[\0\r\n]/.test(value)) {
    throw new ServerInstallerError(
      `OIDC provider ${index} has an invalid ${key}; expected a non-empty single-line string.`,
    );
  }
  return value;
}

function validateOidcEndpoint(value, label, requireHttps) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ServerInstallerError(
      `OIDC provider ${label} must be a valid URL.`,
    );
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new ServerInstallerError(
      `OIDC provider ${label} must be an http or https URL without embedded credentials or a fragment.`,
    );
  }

  if (requireHttps && parsed.protocol !== "https:") {
    throw new ServerInstallerError(
      `Public OIDC provider ${label} must use HTTPS.`,
    );
  }
}

function normalizeOidcProvider(provider, index, requireHttps) {
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    throw new ServerInstallerError(
      `OIDC provider ${index} must be a JSON object.`,
    );
  }

  const normalized = {
    id: providerString(provider, "id", index).trim(),
    displayName: providerString(provider, "displayName", index).trim(),
    issuer: providerString(provider, "issuer", index).trim(),
    audience: providerString(provider, "audience", index).trim(),
    clientId: providerString(provider, "clientId", index).trim(),
  };

  validateOidcEndpoint(normalized.issuer, `${index}.issuer`, requireHttps);

  for (const key of ["authorizationEndpoint", "tokenEndpoint", "jwksUri"]) {
    const value = providerString(provider, key, index, { required: false });
    if (value !== undefined) {
      const endpoint = value.trim();
      validateOidcEndpoint(endpoint, `${index}.${key}`, requireHttps);
      normalized[key] = endpoint;
    }
  }

  for (const key of ["roleClaim", "hostIdsClaim"]) {
    const value = providerString(provider, key, index, { required: false });
    if (value !== undefined) normalized[key] = value.trim();
  }

  if (Object.hasOwn(provider, "clientSecret")) {
    normalized.clientSecret = providerString(provider, "clientSecret", index);
  }

  if (provider.scopes === undefined) {
    normalized.scopes = ["openid", "profile", "email"];
  } else if (
    !Array.isArray(provider.scopes) ||
    provider.scopes.length === 0 ||
    provider.scopes.some(
      (scope) =>
        typeof scope !== "string" || !scope.trim() || /[\0\r\n]/.test(scope),
    )
  ) {
    throw new ServerInstallerError(
      `OIDC provider ${index} has invalid scopes; expected a non-empty string array.`,
    );
  } else {
    normalized.scopes = provider.scopes.map((scope) => scope.trim());
  }

  return normalized;
}

function normalizeOidcProviders(parsed, { requireHttps = false } = {}) {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new ServerInstallerError(
      "The OIDC provider configuration must be a non-empty JSON array.",
    );
  }

  const providers = parsed.map((provider, index) =>
    normalizeOidcProvider(provider, index + 1, requireHttps),
  );
  const ids = new Set();
  for (const provider of providers) {
    if (ids.has(provider.id)) {
      throw new ServerInstallerError(
        `OIDC provider id "${provider.id}" is duplicated.`,
      );
    }
    ids.add(provider.id);
  }

  return providers;
}

async function readOidcProviders(plan) {
  if (plan.authMode !== "oidc") return "[]";
  if (!plan.oidcProvidersFile) {
    throw new ServerInstallerError(
      "--auth-mode oidc requires --oidc-providers-file with at least one provider.",
    );
  }

  let source;
  try {
    source = await readFile(plan.oidcProvidersFile, "utf8");
  } catch {
    throw new ServerInstallerError(
      `Could not read the OIDC provider configuration file ${plan.oidcProvidersFile}.`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch {
    throw new ServerInstallerError(
      "The OIDC provider configuration file must contain valid JSON.",
    );
  }

  return JSON.stringify(
    normalizeOidcProviders(parsed, {
      requireHttps: plan.bindHost === "0.0.0.0",
    }),
  );
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

async function assertEngineTlsFiles(plan) {
  const files = [
    ["CA certificate", plan.engineCaFile],
    ["client certificate", plan.engineCertFile],
    ["client private key", plan.engineKeyFile],
  ];

  for (const [label, file] of files) {
    if (!file) {
      throw new ServerInstallerError(
        `Remote Engine mTLS requires a ${label} file.`,
      );
    }

    let details;
    try {
      details = await stat(file);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        throw new ServerInstallerError(
          `Remote Engine ${label} file was not found at ${file}.`,
        );
      }
      throw error;
    }

    if (!details.isFile() || details.size === 0) {
      throw new ServerInstallerError(
        `Remote Engine ${label} path must be a non-empty regular file: ${file}.`,
      );
    }
  }
}

async function assertPortAvailable(port, host) {
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
              `${host}:${port} is already in use. The installer will not replace an existing gateway or service.`,
            ),
          );
          return;
        }
        reject(error);
      });
    });

    listener.listen({ host, port, exclusive: true }, () => {
      listener.close((error) => {
        finish(() => (error ? reject(error) : resolvePromise()));
      });
    });
  });
}

export async function assertLoopbackPortAvailable(port) {
  return assertPortAvailable(port, "127.0.0.1");
}

export function runCommand(
  command,
  arguments_,
  { cwd, stdio = "inherit", env = process.env } = {},
) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      stdio,
      env,
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

function formatDotenvValue(value) {
  // Compose evaluates double-quoted .env values. Escape dollars before quoting
  // so provider values containing "$" are not treated as Compose expressions.
  const escaped = String(value).replace(/\$/g, "$$$$");
  return JSON.stringify(escaped);
}

async function writeServerEnvironment(plan, randomBytesFn, oidcProvidersJson) {
  const secret = randomBytesFn(32).toString("base64");
  const environment = {
    SECRET_MASTER_KEY: secret,
    // The gateway dials the socket at its in-container path, which the overlay
    // pins, so this stays correct even when the host-side source differs.
    DEV_ENGINE_HOST: plan.engineEndpoint ?? `unix://${containerEngineSocket}`,
    DEV_ENGINE_DISPLAY_NAME: plan.engineName,
    ...(plan.engineEndpoint
      ? {
          ENGINE_CA_FILE: plan.engineCaFile,
          ENGINE_CERT_FILE: plan.engineCertFile,
          ENGINE_KEY_FILE: plan.engineKeyFile,
          DEV_ENGINE_CA_FILE: containerEngineCaFile,
          DEV_ENGINE_CERT_FILE: containerEngineCertFile,
          DEV_ENGINE_KEY_FILE: containerEngineKeyFile,
        }
      : {
          DOCKER_SOCKET_PATH: plan.engineSocket,
        }),
    HARBOR_GATEWAY_PORT: String(plan.port),
    HARBOR_GATEWAY_BIND_HOST: plan.bindHost,
    AUTH_MODE: plan.authMode,
    ALLOWED_ORIGINS: plan.allowedOrigins.join(","),
    OIDC_PROVIDERS_JSON: oidcProvidersJson,
    GATEWAY_VERSION: plan.version,
  };
  const lines = Object.entries(environment).map(
    ([key, value]) => `${key}=${formatDotenvValue(value)}`,
  );

  await writeFile(plan.environmentFile, `${lines.join("\n")}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  return environment;
}

async function writeInstallMarker(plan) {
  const marker = {
    schemaVersion: 1,
    installedAt: new Date().toISOString(),
    packageVersion: plan.version,
    projectName: plan.projectName,
    bindHost: plan.bindHost,
    authMode: plan.authMode,
    gatewayPort: plan.port,
    loopbackPort: plan.port,
    engineMode: plan.engineMode,
    ...(plan.engineEndpoint
      ? { engineEndpoint: plan.engineEndpoint }
      : { engineSocket: plan.engineSocket }),
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
  const isPublic = plan.bindHost === "0.0.0.0";
  const isRemoteEngine = plan.engineMode === "remote-mtls";
  return [
    "Harbor Desk preview gateway install plan",
    `  Host platform: ${supportedPlatforms.get(plan.platform)?.label ?? plan.platform}`,
    `  Directory: ${plan.directory}`,
    `  Compose project: ${plan.projectName}`,
    `  Gateway: ${plan.healthUrl} (${isPublic ? "local health check" : "loopback only"})`,
    `  Network binding: ${plan.bindHost}:${plan.port} (${isPublic ? "public network" : "loopback only"})`,
    `  Authentication: ${plan.authMode}`,
    ...(isRemoteEngine
      ? [
          `  Docker Engine: ${plan.engineEndpoint} (server-side mTLS; material mounted read-only)`,
        ]
      : [`  Docker socket: ${plan.engineSocket}`]),
    `  Server Engine name: ${plan.engineName}`,
    ...(isPublic
      ? [
          "  Warning: public binding is a preview exposure; put it behind TLS/reverse proxy and a firewall.",
          "  Warning: OIDC is required, but this installer is not a production control plane.",
        ]
      : []),
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

  const isRemoteEngine = Boolean(options.engineEndpoint);
  if (isRemoteEngine && options.allowLocalEngineSocket) {
    throw new ServerInstallerError(
      "--engine-endpoint cannot be combined with --allow-local-engine-socket; choose one Engine transport.",
    );
  }

  if (!isRemoteEngine && !options.allowLocalEngineSocket) {
    throw new ServerInstallerError(
      "Refusing to mount a Docker socket without --allow-local-engine-socket. That socket grants highly privileged control of the server.",
    );
  }

  validateServerInstallOptions(options);

  const packageVersion = version ?? (await readPackageVersion(root));
  const plan = buildServerInstallPlan(options, {
    root,
    version: packageVersion,
    platform,
  });

  const oidcProvidersJson = await readOidcProviders(plan);
  await assertPayloadExists(plan.root);
  await assertEmptyTarget(plan.directory);
  if (isRemoteEngine) {
    await assertEngineTlsFiles(plan);
  } else {
    await assertSocket(plan.engineSocket, platform);
  }
  await assertPortAvailable(plan.port, plan.bindHost);
  const runner = await resolveDockerRunner(run, platform);

  if (plan.dryRun) {
    return { plan, installed: false };
  }

  await mkdir(plan.directory, { recursive: true, mode: 0o750 });
  await copyServerPayload(plan);
  const generatedEnvironment = await writeServerEnvironment(
    plan,
    randomBytesFn,
    oidcProvidersJson,
  );
  await writeInstallMarker(plan);

  // Docker Compose lets the invoking process environment override values from
  // --env-file. Re-apply the generated values here so an ambient AUTH_MODE,
  // bind host, port, or provider setting cannot silently change this plan.
  const composeEnvironment = {
    ...process.env,
    ...generatedEnvironment,
  };

  await run(
    runner.command,
    composeArguments(plan, runner, ["config", "--quiet"]),
    { cwd: plan.directory, env: composeEnvironment },
  );
  await run(
    runner.command,
    composeArguments(plan, runner, ["up", "--detach", "--build"]),
    { cwd: plan.directory, env: composeEnvironment },
  );
  await waitForHealth(plan.healthUrl);

  return { plan, installed: true };
}

export function serverInstallerAiContext() {
  return JSON.stringify(
    {
      schemaVersion: 1,
      command: "harbor-desk install-server",
      purpose:
        "Install Harbor Desk's server-side preview gateway on a controlled Docker host.",
      outputContract:
        "This context is stable JSON for an AI or automation client. It does not inspect Docker, write files, or start containers.",
      interaction: {
        interactive: {
          trigger:
            "Run harbor-desk or install-server with no arguments from an interactive SSH TTY.",
          interface: "Keyboard-driven TUI; no browser is opened on the server.",
          prompts: [
            "destination directory (safe default)",
            "local Docker socket or remote Engine mTLS connection",
            "gateway port (default 4311)",
            "local/SSH tunnel or network binding",
            "dev or OIDC authentication when local binding is selected",
            "OIDC provider JSON file when OIDC is selected",
            "allowed client origins when public binding is selected",
            "remote Engine mTLS paths when remote mode is selected",
            "explicit acknowledgement for the server Docker socket mount when local mode is selected",
          ],
          nonTtyBehavior:
            "Fails with SSH TTY guidance instead of waiting for stdin indefinitely.",
        },
        nonInteractive: {
          trigger: "Pass explicit options to install-server.",
          localExample:
            "npm exec --yes harbor-desk -- install-server --directory /srv/harbor-desk-preview --allow-local-engine-socket",
          publicExample:
            "npm exec --yes harbor-desk -- install-server --directory /srv/harbor-desk-public --public --auth-mode oidc --oidc-providers-file ./oidc-providers.json --allowed-origin https://client.example.com --allow-local-engine-socket",
          remoteMtlsExample:
            "npm exec --yes harbor-desk -- install-server --directory /srv/harbor-desk-remote --engine-endpoint https://engine.example.com:2376 --engine-ca-file ./engine-ca.pem --engine-cert-file ./engine-client-cert.pem --engine-key-file ./engine-client-key.pem",
          contextFlags: ["-AI", "--ai-context"],
        },
      },
      supportedPlatforms: [
        { id: "linux", dockerHost: "Docker Engine or Docker Desktop" },
        { id: "win32", dockerHost: "Docker Desktop" },
        { id: "darwin", dockerHost: "Docker Desktop" },
      ],
      defaults: {
        port: defaultPort,
        bindHost: defaultBindHost,
        authMode: defaultAuthMode,
        allowedOrigins: [...defaultAllowedOrigins, "null"],
        engineSocket: defaultEngineSocket,
        projectName: defaultProjectName,
      },
      networkModes: {
        local: {
          bindHost: "127.0.0.1",
          authMode: "dev",
          description: "Loopback-only development preview.",
        },
        public: {
          bindHost: "0.0.0.0",
          authMode: "oidc",
          requiredOptions: [
            "--auth-mode oidc",
            "--oidc-providers-file <path>",
            "one Engine transport: --allow-local-engine-socket or remote mTLS options",
          ],
          deploymentBoundary:
            "Network reachability is enabled, but this remains a preview gateway and must be placed behind TLS or a reverse proxy and a firewall.",
        },
      },
      oidcConfiguration: {
        providerFile: "--oidc-providers-file <path>",
        requiredFields: ["id", "displayName", "issuer", "audience", "clientId"],
        optionalFields: [
          "authorizationEndpoint",
          "tokenEndpoint",
          "jwksUri",
          "roleClaim",
          "hostIdsClaim",
          "scopes",
          "client credentials",
        ],
        publicRequirement: "Every configured OIDC endpoint must use HTTPS.",
      },
      engineConnections: {
        localSocket: {
          requiredOption: "--allow-local-engine-socket",
          endpoint: `unix://${containerEngineSocket}`,
          description:
            "Mounts the server Docker socket read-only into the gateway container; the socket remains highly privileged.",
        },
        remoteMtls: {
          requiredOptions: [
            "--engine-endpoint <https-url>",
            "--engine-ca-file <path>",
            "--engine-cert-file <path>",
            "--engine-key-file <path>",
          ],
          description:
            "Connects from the gateway container to an HTTPS Docker Engine using a server-side CA, client certificate, and client private key.",
          containerMount:
            "The three files are bind-mounted read-only at /run/harbor-desk/engine and are not copied into the install payload.",
        },
      },
      validation: [
        "The destination must be empty or not yet exist.",
        "The published gateway port must be available on the selected bind host.",
        "OIDC configuration must be a non-empty JSON array of provider objects.",
        "Public OIDC endpoints must use HTTPS.",
        "Remote Engine mode requires an HTTPS endpoint and all three mTLS files; it cannot be combined with a socket mount.",
        "Remote Engine certificate paths must be non-empty regular files before installation starts.",
        "The installer refuses to mount the server Docker socket without explicit acknowledgement.",
        "--dry-run validates prerequisites without writing files or starting containers.",
      ],
      trustBoundary: [
        "Docker Engine access stays inside the server-side gateway container.",
        "The Electron renderer and browser client never receive the Engine socket or Docker credentials.",
        "Provider configuration is stored only in the owner-readable server environment file and is never included in this context or the install plan.",
        "Remote Engine mTLS files stay on the server host, are mounted read-only into the gateway, and are never returned to the client.",
        "Public binding does not make this installer production-ready; durable persistence, secret management, TLS termination, and operational controls remain deployment responsibilities.",
      ],
    },
    null,
    2,
  );
}

function defaultInstallDirectory(cwd) {
  return join(cwd, defaultInstallDirectoryName);
}

function tuiKeyName(sequence, key) {
  if (key?.name) return key.name;

  return {
    "\r": "return",
    "\n": "return",
    "\u0003": "c",
    "\u001b": "escape",
    "\u001b[A": "up",
    "\u001b[B": "down",
    "\u007f": "backspace",
  }[sequence];
}

function isTuiCancel(sequence, key) {
  return Boolean(key?.ctrl && key.name === "c") || sequence === "\u0003";
}

function isPrintableTuiInput(sequence, key) {
  return Boolean(
    sequence &&
    !key?.ctrl &&
    !key?.meta &&
    !/[\u0000-\u001f\u007f]/u.test(sequence),
  );
}

function createTuiKeyReader(stdin) {
  emitKeypressEvents(stdin);

  const canSetRawMode =
    Boolean(stdin.isTTY) && typeof stdin.setRawMode === "function";
  const wasRaw = stdin.isRaw;
  if (canSetRawMode) stdin.setRawMode(true);
  stdin.resume();

  return {
    next() {
      return new Promise((resolvePromise) => {
        stdin.once("keypress", (sequence, key) => {
          resolvePromise({ sequence: sequence ?? "", key: key ?? {} });
        });
      });
    },
    close() {
      if (canSetRawMode) stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
    },
  };
}

function writeTuiFrame(stdout, lines) {
  stdout.write(`\u001b[2J\u001b[H${lines.join("\n")}\n`);
}

function tuiLines(value) {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trimEnd());
}

function createTuiUi({ reader, stdout }) {
  const render = (title, body, help, error) => {
    writeTuiFrame(stdout, [
      "Harbor Desk server setup",
      "========================",
      "",
      title,
      "",
      ...body,
      "",
      ...tuiLines(help),
      ...(error ? ["", `Error: ${error}`] : []),
    ]);
  };

  const readKey = async () => {
    const input = await reader.next();
    if (isTuiCancel(input.sequence, input.key)) {
      throw new ServerInstallerError("Setup cancelled; no files were changed.");
    }
    return input;
  };

  return {
    async select({ title, options, defaultValue, help = "" }) {
      if (!Array.isArray(options) || options.length === 0) {
        throw new ServerInstallerError(`TUI field ${title} has no options.`);
      }

      const defaultIndex = options.findIndex(
        (option) => option.value === defaultValue,
      );
      let selected = defaultIndex >= 0 ? defaultIndex : 0;

      for (;;) {
        render(
          title,
          options.map((option, index) => {
            const marker = index === selected ? ">" : " ";
            return `  ${marker} ${option.label}`;
          }),
          `${help}${help ? "\n" : ""}↑/↓ or j/k to move · Enter to select · Ctrl+C to cancel`,
        );

        const { sequence, key } = await readKey();
        const name = tuiKeyName(sequence, key);
        if (name === "up" || sequence === "k") {
          selected = (selected - 1 + options.length) % options.length;
        } else if (name === "down" || sequence === "j") {
          selected = (selected + 1) % options.length;
        } else if (/^[1-9]$/u.test(sequence)) {
          const numericIndex = Number(sequence) - 1;
          if (numericIndex < options.length) selected = numericIndex;
        } else if (name === "return" || sequence === " ") {
          return options[selected].value;
        }
      }
    },

    async text({ title, defaultValue = "", required = false, help = "" }) {
      let edited = false;
      let value = "";
      let error;

      for (;;) {
        const displayed = edited ? value : defaultValue;
        render(
          title,
          [`  > ${displayed}`],
          `${help}${help ? "\n" : ""}Enter to accept · Backspace to edit · Ctrl+C to cancel`,
          error,
        );
        error = undefined;

        const { sequence, key } = await readKey();
        const name = tuiKeyName(sequence, key);
        if (name === "return") {
          const result = (edited ? value : defaultValue).trim();
          if (required && !result) {
            error = "A value is required.";
            continue;
          }
          return result;
        }
        if (name === "backspace") {
          if (!edited) {
            edited = true;
            value = "";
          } else {
            value = value.slice(0, -1);
          }
          continue;
        }
        if (isPrintableTuiInput(sequence, key)) {
          if (!edited) {
            edited = true;
            value = "";
          }
          value += sequence;
        }
      }
    },

    async confirm({ title, defaultValue = false, help = "" }) {
      return this.select({
        title,
        help,
        options: [
          { label: "No", value: false },
          { label: "Yes", value: true },
        ],
        defaultValue,
      });
    },
  };
}

export function formatServerInstallerTuiSummary(options) {
  return [
    `Install directory: ${options.directory}`,
    `Gateway binding: ${options.bindHost}:${options.port}`,
    `Authentication: ${options.authMode}`,
    `Docker connection: ${options.engineEndpoint ?? options.engineSocket}`,
    ...(options.engineEndpoint
      ? ["Engine credentials: server-side mTLS files (paths stay on this host)"]
      : ["Docker socket: mounted into the gateway container"]),
    "",
    formatServerInstallerConnectionInfo(options),
  ].join("\n");
}

export function formatServerInstallerConnectionInfo(options) {
  const isPublic = options.bindHost === "0.0.0.0";
  const gateway = `http://${isPublic ? "<server-address>" : "127.0.0.1"}:${options.port}`;

  return [
    "Connection information",
    `  Gateway: ${gateway}`,
    `  WebSocket: ${gateway.replace(/^http/i, "ws")}`,
    ...(isPublic
      ? [
          "  Public mode: put this behind an HTTPS reverse proxy.",
          "  Client URL after TLS: https://<your-domain>",
          "  WebSocket after TLS: wss://<your-domain>",
        ]
      : [
          `  SSH tunnel: ssh -N -L ${options.port}:127.0.0.1:${options.port} <user>@<server>`,
          `  Desktop URL after tunnel: http://127.0.0.1:${options.port}`,
        ]),
  ].join("\n");
}

export async function collectServerInstallArguments({
  cwd = process.cwd(),
  ui,
} = {}) {
  if (!ui || typeof ui.text !== "function" || typeof ui.select !== "function") {
    throw new TypeError("A TUI input object is required.");
  }

  const directory = await ui.text({
    title: "Install directory",
    defaultValue: defaultInstallDirectory(cwd),
    required: true,
    help: "Press Enter to use the safe per-directory default.",
  });
  const engineMode = await ui.select({
    title: "Docker Engine connection",
    options: [
      { label: "This server's Docker socket (recommended)", value: "local" },
      { label: "Remote Docker Engine over HTTPS + mTLS", value: "remote" },
    ],
    defaultValue: "local",
    help: "The Docker socket and Engine credentials stay on the server.",
  });
  const port = await ui.text({
    title: "Gateway port",
    defaultValue: String(defaultPort),
    required: true,
  });
  const exposure = await ui.select({
    title: "Network binding",
    options: [
      { label: "Local/SSH tunnel only (recommended)", value: "local" },
      {
        label: "Network reachable (requires OIDC + HTTPS proxy)",
        value: "public",
      },
    ],
    defaultValue: "local",
    help: "Local mode binds only to 127.0.0.1.",
  });
  const isPublic = exposure === "public";
  const authMode = isPublic
    ? "oidc"
    : await ui.select({
        title: "Authentication",
        options: [
          { label: "Development login (local only)", value: "dev" },
          { label: "OIDC provider", value: "oidc" },
        ],
        defaultValue: defaultAuthMode,
      });

  const arguments_ = ["--directory", directory, "--port", port];
  if (isPublic) arguments_.push("--public");
  if (authMode !== defaultAuthMode) arguments_.push("--auth-mode", authMode);

  if (authMode === "oidc") {
    const providersFile = await ui.text({
      title: "OIDC provider JSON file",
      required: true,
      help: "Enter the path to the provider configuration on this server.",
    });
    arguments_.push("--oidc-providers-file", providersFile);
  }

  if (isPublic) {
    const allowedOrigins = await ui.text({
      title: "Allowed client origins",
      required: true,
      help: "Comma-separated HTTPS origins, for example https://desk.example.com.",
    });
    arguments_.push("--allowed-origin", allowedOrigins);
  }

  if (engineMode === "remote") {
    const endpoint = await ui.text({
      title: "Remote HTTPS Engine endpoint",
      required: true,
      help: "Example: https://docker.example.com:2376",
    });
    const caFile = await ui.text({
      title: "Engine CA certificate path",
      required: true,
    });
    const certFile = await ui.text({
      title: "Engine client certificate path",
      required: true,
    });
    const keyFile = await ui.text({
      title: "Engine client private key path",
      required: true,
    });
    arguments_.push(
      "--engine-endpoint",
      endpoint,
      "--engine-ca-file",
      caFile,
      "--engine-cert-file",
      certFile,
      "--engine-key-file",
      keyFile,
    );
  } else {
    const acknowledged = await ui.confirm({
      title: "Allow Harbor Desk to mount the server Docker socket?",
      defaultValue: false,
      help: "The socket grants highly privileged Docker control. Choose Yes only if this server is trusted.",
    });
    if (!acknowledged) {
      throw new ServerInstallerError(
        "The server Docker socket mount was not acknowledged; installation stopped.",
      );
    }
    arguments_.push("--allow-local-engine-socket");
  }

  const options = parseServerInstallArgs(arguments_, { cwd });
  const confirmed = await ui.confirm({
    title: "Install Harbor Desk with this configuration?",
    defaultValue: true,
    help: formatServerInstallerTuiSummary(options),
  });
  if (!confirmed) {
    throw new ServerInstallerError("Setup cancelled; no files were changed.");
  }

  return arguments_;
}

async function promptServerInstallTui({ stdin, stdout, cwd }) {
  const reader = createTuiKeyReader(stdin);
  stdout.write("\u001b[?25l");
  try {
    return await collectServerInstallArguments({
      cwd,
      ui: createTuiUi({ reader, stdout }),
    });
  } finally {
    reader.close();
    stdout.write("\u001b[?25h\n");
  }
}

export async function runServerInstaller(
  arguments_,
  {
    cwd = process.cwd(),
    stdin = process.stdin,
    stdout = process.stdout,
    ...dependencies
  } = {},
) {
  if (arguments_.length === 1 && ["--help", "-h"].includes(arguments_[0])) {
    stdout.write(`${serverInstallerUsage()}\n`);
    return { help: true };
  }

  let installArguments = arguments_;
  if (installArguments.length === 0) {
    if (!stdin.isTTY || !stdout.isTTY) {
      throw new ServerInstallerError(
        "Interactive setup requires a TTY. Run this command from an interactive SSH session, or provide explicit install-server options for automation.",
      );
    }
    installArguments = await promptServerInstallTui({
      stdin,
      stdout,
      cwd,
    });
  }

  const options = parseServerInstallArgs(installArguments, { cwd });
  if (options.aiContext) {
    stdout.write(`${serverInstallerAiContext()}\n`);
    return { aiContext: true };
  }

  const result = await installServer(options, dependencies);
  stdout.write(`${formatServerInstallPlan(result.plan)}\n`);

  if (result.installed) {
    stdout.write(
      `Installed Harbor Desk preview gateway. Health: ${result.plan.healthUrl}\n`,
    );
    stdout.write(`${formatServerInstallerConnectionInfo(result.plan)}\n`);
  } else {
    stdout.write("Dry run passed. No files or containers were changed.\n");
  }

  return result;
}

export const serverInstallerPayload = Object.freeze({
  defaultAuthMode,
  defaultBindHost,
  defaultEngineSocket,
  defaultPort,
  defaultProjectName,
  payloadPaths: payloadEntries.map(({ source }) => source),
});
