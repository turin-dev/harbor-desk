# Harbor Desk

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

Use the npm command to find the source, preview releases, and the private
server-side installation path:

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

On a controlled Linux Docker host, the explicit `install-server` command copies
the gateway source payload from the published npm package, creates a unique
server secret, builds the gateway, and starts it behind a loopback-only port.
The command requires an empty target directory and will refuse to overwrite an
existing install or use an occupied port.

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

To create a Windows unpacked build or NSIS installer after configuring the
gateway URL, run:

```powershell
pnpm --filter @harbor/desktop package:dir
pnpm --filter @harbor/desktop package:win
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

## License

Apache-2.0. See [LICENSE](./LICENSE).
