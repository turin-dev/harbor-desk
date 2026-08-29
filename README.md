# Harbor Desk

[![CI](https://github.com/turin-dev/harbor-desk/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/turin-dev/harbor-desk/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/harbor-desk?logo=npm)](https://www.npmjs.com/package/harbor-desk)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Release](https://img.shields.io/github/v/release/turin-dev/harbor-desk?include_prereleases&sort=semver)](https://github.com/turin-dev/harbor-desk/releases)

Harbor Desk is an open-source, client-first desktop app for operating remote
Docker Engines. The user configures one Gateway or Docker Engine target and the
desktop detects which it is. A Harbor Desk Gateway is used directly; a raw
Docker Engine gets a short-lived Local Gateway wrapper on a dynamically
assigned `127.0.0.1` port. Every operation still stays behind a Gateway, so the
renderer does not require Docker Desktop, Docker CLI, or a local Docker socket.

> **Project status:** Harbor Desk is an independently implemented, working
> vertical slice for remote container operations. Its Server Gateway and Local
> Gateway wrapper are explicit connection modes, not a turnkey production
> control plane. The production dependencies and hardening still called out
> below are deliberate release boundaries, not hidden fallbacks.

Harbor Desk uses a familiar container-management workflow, but it does not
include Docker Desktop source code, assets, or direct renderer-to-Engine
integration.

## Contents

- [Current implementation](#current-implementation)
- [npm server setup](#npm-server-setup)
- [Supported platforms](#supported-platforms)
- [Architecture and trust boundary](#architecture-and-trust-boundary)
- [Getting started](#getting-started)
- [Server-local Engine overlay](#server-local-engine-overlay)
- [Configuration and deployment safety](#configuration-and-deployment-safety)
- [Project layout](#project-layout)
- [Contributing and security](#contributing-and-security)
- [License](#license)

## Current implementation

The repository currently contains a working first vertical slice:

- Electron + React + TypeScript + MUI desktop shell.
- Automatic detection of a Harbor Desk Gateway versus a Docker Engine target.
- Direct Server Gateway connections, or a Local Gateway wrapper that binds only
  to `127.0.0.1` on an OS-assigned port for raw Engine targets.
- A random per-launch desktop session token that protects Local Gateway API
  calls, including requests from the packaged renderer's `file://` origin.
- Remote host registry and development Engine connector.
- Host-aware container list, live filtering, run/create+start, lifecycle
  actions, action menu, inspect/logs/stats, one-shot exec terminal sessions,
  and cursor-resumable event stream.
  actions, action menu, inspect/logs/stats, one-shot exec terminal sessions,
  and cursor-resumable event stream.
- Container run options: published ports, environment variables, restart
  policy, and labels, with client-side validation before create+start.
- Live image pull progress through gateway operation polling (determinate
  progress and status messages), and prune operations for containers,
  images, volumes, and networks from their resource screens.
- Live image inspect/remove, volume create/inspect/delete, and network
  create/inspect/delete flows with destructive-action confirmation.
- Quick search across live remote resources, event notification center, toast
  feedback, persistent client preferences, Windows login-item integration,
  resizable terminal drawer, command history, copy, and clear actions.
- A startup update check against public Harbor Desk GitHub Release metadata,
  with stable/preview channel selection, a manual status-bar check, and an
  explicit release-page action. It never downloads or installs a binary.
- Live gateway/host Troubleshoot diagnostics and a redacted About diagnostic
  summary.
- Operation records with idempotency keys for container mutations, audit
  metadata for implemented mutation paths, and short-lived WebSocket tickets.
  metadata for implemented mutation paths, and short-lived WebSocket tickets.

- An admin-only Audit log screen that renders the gateway audit trail with
  actor, host, action, resource, and result states, and a clear
  permission-denied state for non-admin users.
- Generic OIDC provider selection, Authorization Code + PKCE browser launch,
  server-side token exchange, and Electron keychain refresh-token storage.
- Remote-native settings and connection/status states.
- Docker-socket-free renderer boundary enforced by Electron preload.

PostgreSQL/Redis persistence, Vault/KMS secret storage, BullMQ processors for
BuildKit/Compose/export/scan, host-grant persistence, and the remaining
Kubernetes/registry/extension/AI adapters are intentionally still separate
implementation work. Their screens show an explicit unavailable state rather
than fixture data or fake success. The Local Gateway wrapper currently keeps
host registrations, encrypted development secrets, and operations in memory,
so they reset when the app fully quits; a Server Gateway owns its own durable
deployment state.

## npm server setup

GitHub Release assets and the public npm registry are separate distribution
channels. Check the registry before assuming an unpinned `npm exec` command
matches the newest GitHub release:

```powershell
npm view harbor-desk version
npm view harbor-desk dist-tags --json
```

Stable releases use npm's `latest` dist-tag. GitHub prereleases are published
under the `preview` dist-tag so an unpinned command does not unexpectedly move
to a preview. To use an exact published preview version:

```powershell
npm view harbor-desk@0.6.1 version
npm exec --yes harbor-desk@0.6.1 -- --version
```

GitHub Release assets and npm packages are published separately. Each
generated release note records the npm version and dist-tag observed after the
tagged package is published. If the requested version is not yet available in
the registry, download the matching `harbor-desk-<version>.tgz` and
`SHA256SUMS` assets, verify the checksum, and invoke the tarball explicitly:

```powershell
npm exec --yes --package ./harbor-desk-<version>.tgz -- harbor-desk --version
```

The registry-backed npm command is the server-side entry point. Run it inside an
interactive SSH session on the Docker host:

```powershell
npm exec --yes harbor-desk
npm exec --yes harbor-desk -- install
npm exec --yes harbor-desk -- install-server
npm exec --yes harbor-desk -- --open-release
npm exec --yes harbor-desk -- -AI
```

The default command, `install`, and `install-server` commands open the same
keyboard-driven TUI when they are run with a TTY. No browser is opened on the
server. Use arrow keys or `j`/`k`, press Enter to select, and press Ctrl+C to
cancel. The wizard uses a safe directory and port default, detects the local
Docker socket as the common path, lets you choose remote Engine mTLS when
needed, validates the selected connection, and asks for confirmation before
writing files or starting containers:

```text
Harbor Desk server setup

Docker Engine connection
  > This server's Docker socket (recommended)
    Remote Docker Engine over HTTPS + mTLS

↑/↓ or j/k to move · Enter to select · Ctrl+C to cancel
```

At the end it prints the connection details. In the default loopback mode this
includes the SSH tunnel command and the client URL to use after opening the
tunnel. The ordinary desktop client still does not access a local Docker
socket; only the server-side Gateway does.

If stdin or stdout is not a TTY, the command fails with SSH guidance instead
of waiting for input. Use explicit `install-server` options for CI and other
non-interactive environments. The command does not install or launch the
Electron desktop application on the server.

### Dedicated server gateway

The normal desktop flow accepts either an already running Server Gateway or a
Docker Engine endpoint. A raw Engine target is wrapped by a Local Gateway in
the desktop process; a Server Gateway is never duplicated locally. On a
controlled Linux, Windows, or macOS Docker host, the TUI installs a dedicated external preview gateway by
copying the gateway payload, creating a per-install server secret, building the
gateway, and starting it on a loopback or explicitly selected network binding.
The installer requires an empty target directory and refuses to overwrite an
existing install or use an occupied port.

`-AI` (also accepted as `--ai-context`) prints stable JSON describing the
commands, defaults, platform support, and security boundary without reading
Docker or touching the filesystem:

```powershell
npm exec --yes harbor-desk -- install-server -AI
```

The examples below use the npm-published package. When the GitHub release is
newer than the registry, replace the `npm exec --yes harbor-desk --` prefix with
`npm exec --yes --package ./harbor-desk-<version>.tgz -- harbor-desk` after
verifying the downloaded tarball.

```bash
npm exec --yes harbor-desk -- install-server \
  --directory /srv/harbor-desk-preview \
  --port 4311 \
  --engine-name "server local Docker Engine" \
  --allow-local-engine-socket
```

Use `--dry-run` to validate Docker Compose access, the Docker socket, target
directory, authentication configuration, and published port without creating
files or containers. The default is loopback plus development authentication:

```bash
npm exec --yes harbor-desk -- install-server \
  --directory /srv/harbor-desk-preview \
  --port 4311 \
  --allow-local-engine-socket \
  --dry-run
```

Loopback preview installs include the opaque `Origin: null` used by a packaged
Electron renderer, in addition to the local Vite origins. The installer refuses
that origin for a public bind; public deployments must provide an explicit
HTTPS client origin instead.

For a network-reachable preview, opt in explicitly. Public binding refuses
development authentication and requires a non-empty OIDC provider JSON array;
provider endpoints must use HTTPS. The browser origin must be supplied for the
client that will call the gateway:

```bash
npm exec --yes harbor-desk -- install-server \
  --directory /srv/harbor-desk-public \
  --public \
  --auth-mode oidc \
  --oidc-providers-file ./oidc-providers.json \
  --allowed-origin https://client.example.com \
  --allow-local-engine-socket
```

`--public` only changes the published port binding to `0.0.0.0`; it is not a
production deployment or a substitute for TLS. Put the preview behind a
TLS-terminating reverse proxy and a firewall, restrict `--allowed-origin` to
origins you control, and protect the provider file. The install plan reports
the public warning but never prints provider credentials. The remote Engine mTLS
options below protect the gateway-to-Engine connection; they do not terminate
client-to-gateway TLS or replace a public reverse proxy.

To connect the server gateway to a remote Docker Engine without mounting the
server Docker socket, pass an HTTPS Engine endpoint and all three mTLS files:

```bash
npm exec --yes harbor-desk -- install-server \
  --directory /srv/harbor-desk-remote \
  --engine-endpoint https://engine.example.com:2376 \
  --engine-ca-file /etc/harbor-desk/engine/ca.pem \
  --engine-cert-file /etc/harbor-desk/engine/client-cert.pem \
  --engine-key-file /etc/harbor-desk/engine/client-key.pem
```

The installer validates that each file is a non-empty regular file, keeps the
source files on the server host, and bind-mounts them read-only at
`/run/harbor-desk/engine` inside the gateway container. The generated
`.harbor-desk.env` contains only the source paths and is owner-readable; the
certificate contents are not copied into the install directory, emitted in the
AI context, or returned to a client. Remote Engine mode and
`--allow-local-engine-socket` are mutually exclusive.

`install-server` is a **development preview** installer, not a production
control-plane installer. It uses the documented server-local Engine overlay;
the explicit socket acknowledgement is required because Docker socket access
is highly privileged even with a read-only bind mount. The generated
`.harbor-desk.env` is created with owner-only permissions and is never printed.

On a Windows or macOS host running Docker Desktop, pass a native destination
path instead. The Engine socket stays `/var/run/docker.sock` on every platform,
because Docker Desktop resolves that bind source inside its own Linux virtual
machine rather than on the host filesystem.

```powershell
npm exec --yes harbor-desk -- install-server --directory C:\harbor-desk-preview --port 4311 --allow-local-engine-socket
```

## Supported platforms

| Component                                  | Linux                           | Windows        | macOS                    |
| ------------------------------------------ | ------------------------------- | -------------- | ------------------------ |
| Desktop client + adaptive Gateway wrapper  | AppImage, deb                   | NSIS installer | dmg, zip (x64 and arm64) |
| Optional server gateway (`install-server`) | Docker Engine or Docker Desktop | Docker Desktop | Docker Desktop           |

The Local Gateway wrapper is bundled with the desktop client and starts only
when the configured target is a raw Docker Engine; it does not start or install
Docker. A configured Server Gateway is used directly. The optional server
gateway runs as a container on any host with Docker Compose, so the same command
works against a native Linux Engine and against Docker Desktop. The client
never requires a local Docker Engine on any platform.

Release artifacts are built by the `Release` workflow on `ubuntu-latest`,
`windows-latest`, and `macos-latest`. They are **unsigned** unless the build
environment supplies signing material, so macOS Gatekeeper and Windows SmartScreen
will warn. Do not treat an unsigned artifact as a trusted production release.

### Update checks

The desktop checks the public Harbor Desk release list once after startup by
default. The request is an unauthenticated metadata-only `GET` from the Electron
main process to `api.github.com`; no Docker endpoint, gateway token, host name,
or client preference is sent. The request's `User-Agent` identifies Harbor Desk
and its current semantic version. **Settings → General** can disable automatic
checks or exclude preview releases. The status bar always provides a manual
check.

When a newer semantic version is available, the renderer receives only the
current version, newer version, check time, status message, and a release-page
state. Choosing **View release** asks the main process to open the fixed
`github.com/turin-dev/harbor-desk/releases/tag/...` page. Harbor Desk does not
read asset download URLs, download packages, run an installer, or replace the
current application automatically. Users must review release notes, signatures,
and `SHA256SUMS` before choosing to install an artifact.

## Architecture and trust boundary

```text
Electron renderer -- HTTP / WebSocket --> Server Gateway --> Docker Engine
                                      or Local Gateway wrapper
   no Docker SDK       per-launch token only for wrapper   selected host
   no Docker socket    127.0.0.1 dynamic port             connector boundary
```

The Electron main process detects the configured target before creating the
window. A Server Gateway is used directly without starting a desktop Gateway.
When the target is a raw Docker Engine, the main process starts a Local Gateway
wrapper on an OS-assigned loopback port. The wrapper accepts API calls only with
a random token generated for that app launch; the preload exposes only a narrow
getter so the renderer can attach the token to wrapper requests. The token is
not written to diagnostics or logs. Closing the window to the tray leaves the
app and any Local Gateway wrapper running; choosing **Quit** stops the wrapper.

The renderer is a control-plane client only. It never receives a Docker socket
or talks directly to an Engine. The gateway authenticates each request, applies
host authorization, records audit metadata, and makes the selected Engine call.
A host selector in the desktop application is not a security boundary.

Connection detection first checks HTTP(S) targets for the Harbor Desk Gateway
health and auth-provider endpoints. If the target is not a Gateway, local
loopback Engine endpoints, `npipe:`, and `unix:` are allowed for development;
remote raw Engines must use HTTPS with CA, client certificate, and private key.
`VITE_GATEWAY_URL` is only an optional first-target seed for development builds;
it does not reserve a local port or imply that a Gateway should start.

## Getting started

Prerequisites:

- Node.js 22 or newer
- pnpm 11.18.0 (Corepack is supported)
- Docker is optional for renderer work; it is needed only when running the
  local service dependencies or a gateway that connects to an Engine

From the repository root, run the safe bootstrap script for your platform. The
scripts install dependencies and create .env from .env.example only when .env
does not already exist. They do not start Docker, open ports, or deploy Compose
services.

```powershell
.\setup.ps1
```

```bash
bash setup.sh
```

For the full Electron development flow, install dependencies and launch the
desktop. Configure a target in Settings, or provide `VITE_GATEWAY_URL` as the
first-target seed:

```powershell
pnpm install
Copy-Item .env.example .env
pnpm --filter @harbor/desktop dev:electron
```

Running only the Vite renderer in a normal browser has no Electron preload, so
that browser-only workflow still needs a separately started development
Gateway and `VITE_GATEWAY_URL`:

```powershell
pnpm --filter @harbor/gateway dev
pnpm --filter @harbor/desktop dev
```

### Eight-hour runtime check

The soak command verifies that the gateway and renderer stay reachable for
eight hours. Pass the Electron main-process ID when checking a running desktop
window as well; a missing process is recorded as a failed check.

```powershell
$env:SOAK_DESKTOP_PID = "<Electron main-process ID>"
pnpm run soak:8h
```

Use SOAK_PROCESS_PIDS with a comma-separated list when other long-running
processes must be checked in the same run. The default check interval is
30 seconds and can be shortened only for a local smoke test with
SOAK_INTERVAL_MS.

To create a desktop build, run the command for the platform you are building
on. The default package needs no separate gateway configuration because it
includes the managed loopback runtime. electron-builder builds each target on
its own operating system, so run these on the matching host:

```powershell
pnpm --filter @harbor/desktop package:dir
pnpm --filter @harbor/desktop package:win
```

The Windows target is a branded, bilingual English/Korean assisted NSIS
installer. It preserves the existing upgrade identity, lets the user choose a
per-user or all-users install and destination, creates Start menu and desktop
shortcuts, and launches the client only when the finish-page option remains
selected. The installed application itself always runs with `asInvoker`; only
an explicitly selected all-users installation may request elevation.

Installer artwork is generated from
`scripts/generate-installer-assets.py` and checked in under
`apps/desktop/build/`. See `apps/desktop/build/README.md` before changing the
fixed NSIS GUID or branding resources.

```bash
pnpm --filter @harbor/desktop package:linux
pnpm --filter @harbor/desktop package:mac
```

The installer is unsigned unless the build environment supplies a signing
certificate through the electron-builder signing configuration. Do not publish
an unsigned artifact as a trusted production release.

For a standalone/server development connector, set `DEV_ENGINE_HOST` to a
protected Engine endpoint. The Server Gateway or Local Gateway wrapper reads
this value; the renderer does not. Do not expose an unauthenticated Docker
daemon in production, and do not point a Local Gateway wrapper at an untrusted
endpoint.

## Server-local Engine overlay

The optional **infra/compose/docker-compose.preview.local-engine.yml** overlay
is a server-side development fixture. It can bind the host Docker socket into
the gateway container so the gateway can connect to a Docker Engine on the same
server. It is not a client-local Engine fallback.

For a remote server, use the **infra/compose/docker-compose.preview.remote-engine.yml**
overlay through the four `--engine-*` options instead. It keeps Docker Engine
access inside the gateway and uses HTTPS plus CA/client certificate/client key
mTLS without mounting a server Docker socket.

A bind mount marked read-only protects the socket file mount, not the Docker
API. A process that can use that socket can generally perform highly privileged
Docker operations on the server. Use this overlay only on a controlled
development machine or private preview host. Do not publish the socket or treat
the overlay as production isolation. If the gateway itself is made network-
reachable with `install-server --public`, the installer requires OIDC, but the
preview still needs TLS/reverse-proxy termination, firewall rules, narrow CORS
origins, and operational monitoring before any external users are allowed to
reach it.

The base preview Compose file does not mount a Docker socket and binds its
gateway port to loopback by default. The installer can change only the published
gateway bind host; the gateway still listens on its internal container port.
Compose configuration can be reviewed without starting any service:

```powershell
$env:SECRET_MASTER_KEY = "replace-with-a-unique-local-value"
$env:DEV_ENGINE_HOST = "unix:///var/run/docker.sock"
docker compose -f infra/compose/docker-compose.preview.yml -f infra/compose/docker-compose.preview.local-engine.yml config
```

## Configuration and deployment safety

The checked-in .env.example and Compose defaults are development examples, not
credentials for a deployment. Never commit a real .env file, certificate,
private key, OIDC client secret, access token, or Docker endpoint credential.
The reference Compose services bind published ports to loopback to reduce
accidental network exposure.

For production, use client-to-gateway TLS (normally at a reverse proxy),
AUTH_MODE=oidc, an explicit Engine hostname allowlist, HTTPS Engine endpoints
with server-side mTLS material, and an injected
Vault/KMS-backed secret store. PostgreSQL/Redis persistence, a production
Vault/KMS adapter, durable host grants, workers, and the remaining adapters
are not complete in this vertical slice. Do not describe it as production-ready
until those acceptance checks are implemented and operated.

## Project layout

- **apps/desktop** — Electron main process, preload boundary, and React renderer
- **apps/gateway** — Fastify API, authorization, audits, and Engine connector
- **apps/worker** — background-worker entry point
- **packages/** — shared contracts, configuration, Engine client, and UI
- **infra/** — schema migrations and reference Compose files
- **docs/operations/** — architecture and security-boundary notes

## Contributing and security

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a change and
[SECURITY.md](./SECURITY.md) before reporting a vulnerability. The contributor
guide includes validation commands and the boundary that must remain intact:
the renderer must never acquire direct Docker Engine access.

Report a vulnerability through
[private security advisories](https://github.com/turin-dev/harbor-desk/security/advisories/new),
not a public issue. Release-by-release changes are recorded in
[CHANGELOG.md](./CHANGELOG.md), and expected participant behavior is described in
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## License

Apache-2.0. See [LICENSE](./LICENSE) for the license text and [NOTICE](./NOTICE)
for attribution.

Harbor Desk is an independent project. It is not affiliated with, endorsed by,
or derived from Docker, Inc. "Docker" is a trademark of Docker, Inc., used here
only to describe Docker Engine API compatibility.
