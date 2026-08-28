# Harbor Desk architecture

## Boundary

The Electron application uses a client-first lifecycle but is not itself a
Docker client. Before creating the renderer window, the main process starts a
Fastify gateway on exact loopback (`127.0.0.1`) unless an explicit external
gateway is configured or automatic startup is disabled. The renderer has no
Docker CLI, Docker SDK, Engine socket, or direct Engine connection. It can
submit endpoint and mTLS material during registration, but the gateway owns
their storage and use and never returns them in host responses. The renderer
calls the gateway using HTTP(S) and WebSocket only.

The gateway is the policy boundary. It authenticates the user, checks the
host-level grant, validates the request, writes audit metadata, and invokes a
connector for the selected host. The gateway must not expose a generic
`/proxy?url=` route or host-shell execution endpoint. The current in-memory
stores are a development slice; PostgreSQL/Redis-backed stores are required
before a production deployment.

The managed gateway receives a random token for each desktop launch. Protected
requests from the renderer must carry that token in
`x-harbor-desktop-token`, including packaged `file://` requests whose CORS
origin is `null`. The main process keeps the token and exposes a narrow preload
getter; diagnostics must never include it. This is a loopback channel guard,
not a replacement for user authentication or process isolation.

## Standalone server preview

The optional `npx harbor-desk install-server` flow copies a minimal gateway
payload to a user-selected empty directory and runs it with either the
server-local Engine overlay or the remote-Engine mTLS overlay. The default
published port binds to exact loopback and uses development authentication.
Running the command with no arguments in a TTY opens a setup questionnaire;
automation must pass explicit options or use `-AI`/`--ai-context` to retrieve
the stable setup contract without starting anything.

`--public` is an explicit network-binding opt-in. It changes only the host-side
published port to `0.0.0.0`; the gateway still listens on its internal container
port. Public binding requires OIDC and a non-empty provider JSON file, and the
installer rejects non-HTTPS provider endpoints. This is an authenticated
preview path, not a production control plane: TLS or reverse-proxy termination,
firewall policy, narrow allowed origins, durable persistence, secret management,
and monitoring remain deployment responsibilities.

The provider file is copied into an owner-readable environment file for the
gateway and is not included in the AI context or formatted plan. The Docker
socket remains an explicit server-side high-privilege mount; it is never handed
to the Electron renderer or a browser client. An alternative remote Engine mode
uses an HTTPS endpoint and three administrator-supplied mTLS files. Those files
remain on the server host and are mounted read-only only inside the gateway
container; this protects the gateway-to-Engine hop and is separate from
client-to-gateway TLS termination.

## Update discovery

The renderer does not contact a package feed. After startup, the React bridge
can ask the Electron main process to list public releases for the fixed
`turin-dev/harbor-desk` GitHub repository. The main process applies a timeout,
response-size limit, draft/prerelease channel filtering, and semantic-version
comparison, then sends a typed status over IPC. Duplicate automatic checks are
cooled down within the desktop session.

The update path is discovery-only. It does not consume release asset URLs or
invoke a platform installer. A user action can open only a validated HTTPS
release-tag page for this repository in the system browser. Automatic checks
are enabled by default but can be disabled in persisted client preferences.

## Host connection

Production host records use an HTTPS Docker Engine endpoint and server-side
mTLS material. The endpoint is an administrator-controlled value; client
certificates and private keys are encrypted by the configured secret store and
are never serialized into the public `Host` response.

Development can use a loopback HTTP endpoint or a Windows `npipe:` endpoint
from the gateway process. The desktop-managed gateway may read
`DEV_ENGINE_HOST`, but the renderer never receives or interprets that value.
No automatic local-Engine fallback exists and Harbor Desk never starts Docker.

The standalone server installer can select the remote Engine path with
`--engine-endpoint`, `--engine-ca-file`, `--engine-cert-file`, and
`--engine-key-file`. It then selects the remote-engine Compose overlay instead
of mounting a local socket. The endpoint must use HTTPS and all three files must
exist before installation proceeds.

The connector probes `/version` and `/info`, records the negotiated API and
capability matrix, and maps upstream errors to stable gateway error codes.
Unsupported capabilities are visible to the UI and block the relevant action.
Container inspect, logs, stats, and one-shot exec output are exposed through
typed gateway routes. Exec commands run inside the selected container only;
command contents are not placed in audit records.

## Authentication

OIDC providers are configured by deployment configuration. The provider list is
public metadata; access tokens are required for protected API routes in
production. Development mode is only enabled when the gateway is running in a
non-production environment.

The client uses Authorization Code + PKCE through the system browser. A short-
lived access token is kept in renderer memory; refresh material is stored by
the Electron main process using Windows OS-protected storage.
The gateway issues a one-time, 60-second WebSocket ticket after bearer
authentication so browser WebSocket connections do not carry a long-lived
access token in their URL.

## Data and jobs

- PostgreSQL stores users, organization membership, hosts, grants, operations,
  notifications, and audit metadata.
- Redis carries event fan-out and BullMQ operation queues.
- S3-compatible storage stores volume exports, build records, and scan
  artifacts.
- A Vault/KMS implementation is the production secret store. The development
  fallback encrypts values in memory with AES-256-GCM and a process master key.
  The gateway requires a secret store to be injected in production; the
  standalone server currently has no Vault/KMS adapter and intentionally fails
  closed instead of starting with the in-memory fallback.

## Failure policy

If the managed gateway cannot bind or initialize, the renderer shell still
loads and reports an unavailable runtime in Troubleshoot. It must not replace
the full interface with a blank or gateway-error-only page.

If a host cannot be reached, the UI may display the last known host status but
must not execute mutations. A failed WebSocket resumes from its cursor when
possible; otherwise the client requests a fresh snapshot. A failed upstream
Engine request returns `502 engine_unavailable` without exposing stack traces,
certificate material, or upstream response bodies.
