# Harbor Desk

[![CI](https://github.com/turin-dev/harbor-desk/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/turin-dev/harbor-desk/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/harbor-desk?logo=npm)](https://www.npmjs.com/package/harbor-desk)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Release](https://img.shields.io/github/v/release/turin-dev/harbor-desk?include_prereleases&sort=semver)](https://github.com/turin-dev/harbor-desk/releases)

Harbor Desk is an open-source, remote-first container operations desktop client.
It provides a Docker Desktop-shaped workflow while keeping every Docker Engine
connection on the server side. The Windows client talks to a Fastify gateway
over HTTPS and WebSocket; it does not require Docker Desktop, Docker CLI, or a
local Docker socket.

> **Project status:** Harbor Desk is an independently implemented, working
> vertical slice for remote container operations. It is not yet a turnkey
> production control plane. The production dependencies and hardening still
> called out below are deliberate release boundaries, not hidden fallbacks.

Harbor Desk uses a familiar container-management workflow, but it does not
include Docker Desktop source code, assets, or a client-side Engine integration.

## Contents

- [Current implementation](#current-implementation)
- [npx bootstrap](#npx-bootstrap)
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
- Fastify gateway with typed `/api/v1` responses.
- Remote host registry and development Engine connector.
- Host-aware container list, live filtering, run/create+start, lifecycle
  actions, action menu, inspect/logs/stats, one-shot exec terminal sessions,
  and cursor-resumable event stream.
- Live image inspect/remove, volume create/inspect/delete, and network
  create/inspect/delete flows with destructive-action confirmation.
- Quick search across live remote resources, event notification center, toast
  feedback, persistent client preferences, Windows login-item integration,
  resizable terminal drawer, command history, copy, and clear actions.
- Live gateway/host Troubleshoot diagnostics and a redacted About diagnostic
  summary.
- Operation records with idempotency keys for container mutations, audit
  metadata for implemented mutation paths, and short-lived WebSocket tickets.
- Generic OIDC provider selection, Authorization Code + PKCE browser launch,
  server-side token exchange, and Electron keychain refresh-token storage.
- Remote-native settings and connection/status states.
- Docker-socket-free renderer boundary enforced by Electron preload.

PostgreSQL/Redis persistence, Vault/KMS secret storage, BullMQ processors for
BuildKit/Compose/export/scan, host-grant persistence, and the remaining
Kubernetes/registry/extension/AI adapters are intentionally still separate
implementation work. Their screens show an explicit unavailable state rather
than fixture data or fake success.

## npx bootstrap

GitHub Release assets and the public npm registry are separate distribution
channels. Check the registry before assuming an unpinned `npx` command matches
the newest GitHub release:

```powershell
npm view harbor-desk version
```

At the v0.3.1 release, the registry still reported v0.2.0. Each generated
release note records the registry version observed by the release workflow. If
the versions differ, download the matching `harbor-desk-<version>.tgz` and
`SHA256SUMS` assets, verify the checksum, and invoke the tarball explicitly. For
v0.3.1:

```powershell
npx --yes --package ./harbor-desk-0.3.1.tgz harbor-desk --version
```

The registry-backed npm command can find the source, preview releases, and the
private server-side installation path:

```powershell
npx --yes harbor-desk
npx --yes harbor-desk --open-release
```

The default command does **not** install or launch the Electron desktop
application, download an unsigned Windows installer, access Docker Desktop,
contact a local Docker socket, or start a Docker daemon. It is intentionally a
safe entry point into the open-source preview while the desktop installer
remains unsigned and the production control-plane dependencies are still
incomplete.

### Install a server-side preview gateway

On a controlled Linux, Windows, or macOS Docker host, the explicit
`install-server` command copies the gateway source payload from the published
npm package, creates a unique server secret, builds the gateway, and starts it
behind a loopback-only port. The command requires an empty target directory and
will refuse to overwrite an existing install or use an occupied port.

The examples below use the npm-published package. When the GitHub release is
newer than the registry, replace the `npx --yes harbor-desk` prefix with
`npx --yes --package ./harbor-desk-<version>.tgz harbor-desk` after verifying the
downloaded tarball.

```bash
npx --yes harbor-desk install-server \
  --directory /srv/harbor-desk-preview \
  --port 4311 \
  --engine-name "server local Docker Engine" \
  --allow-local-engine-socket
```

Use `--dry-run` to validate Docker Compose access, the Docker socket, target
directory, and loopback port without creating files or containers:

```bash
npx --yes harbor-desk install-server \
  --directory /srv/harbor-desk-preview \
  --port 4311 \
  --allow-local-engine-socket \
  --dry-run
```

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
npx --yes harbor-desk install-server --directory C:\harbor-desk-preview --port 4311 --allow-local-engine-socket
```

## Supported platforms

| Component                         | Linux                           | Windows        | macOS                    |
| --------------------------------- | ------------------------------- | -------------- | ------------------------ |
| Server gateway (`install-server`) | Docker Engine or Docker Desktop | Docker Desktop | Docker Desktop           |
| Desktop client                    | AppImage, deb                   | NSIS installer | dmg, zip (x64 and arm64) |

The server gateway runs as a container on any host with Docker Compose, so the
same command works against a native Linux Engine and against Docker Desktop. The
client is a control-plane application and never requires a local Docker Engine on
any platform.

Release artifacts are built by the `Release` workflow on `ubuntu-latest`,
`windows-latest`, and `macos-latest`. They are **unsigned** unless the build
environment supplies signing material, so macOS Gatekeeper and Windows SmartScreen
will warn. Do not treat an unsigned artifact as a trusted production release.

## Architecture and trust boundary

```text
Electron renderer  -- HTTPS / WebSocket -->  Fastify gateway  -->  Docker Engine
      no Docker SDK                            policy boundary       selected host
      no Docker socket                         server-side connector
```

The renderer is a control-plane client only. It never receives an Engine
endpoint, Engine certificate, Docker socket, or host credential. The gateway
authenticates a request, applies server-side host authorization, records audit
metadata, and makes the selected Engine call. A host selector in the desktop
application is not a security boundary.

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

The equivalent manual workflow is:

```powershell
pnpm install
Copy-Item .env.example .env
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

To create a desktop client build after configuring the gateway URL, run the
command for the platform you are building on. electron-builder builds each
target on its own operating system, so run these on the matching host:

```powershell
pnpm --filter @harbor/desktop package:dir
pnpm --filter @harbor/desktop package:win
```

```bash
pnpm --filter @harbor/desktop package:linux
pnpm --filter @harbor/desktop package:mac
```

The installer is unsigned unless the build environment supplies a signing
certificate through the electron-builder signing configuration. Do not publish
an unsigned artifact as a trusted production release.

For a local-only development connector, set `DEV_ENGINE_HOST` to a protected
development Engine endpoint. Do not expose an unauthenticated Docker daemon in
production. The desktop client itself never reads this variable and never
connects to Docker.

## Server-local Engine overlay

The optional **infra/compose/docker-compose.preview.local-engine.yml** overlay
is a server-side development fixture. It can bind the host Docker socket into
the gateway container so the gateway can connect to a Docker Engine on the same
server. It is not a client-local Engine fallback.

A bind mount marked read-only protects the socket file mount, not the Docker
API. A process that can use that socket can generally perform highly privileged
Docker operations on the server. Use this overlay only on a controlled
development machine or private preview host. Do not publish the socket, expose
the preview gateway directly to the Internet, or treat the overlay as
production isolation.

The base preview Compose file does not mount a Docker socket and binds its
gateway port to loopback. Compose configuration can be reviewed without
starting any service:

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

For production, use TLS, AUTH_MODE=oidc, an explicit Engine hostname allowlist,
HTTPS Engine endpoints with server-side mTLS material, and an injected
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
