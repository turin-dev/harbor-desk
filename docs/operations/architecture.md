# Harbor Desk architecture

## Boundary

The Windows Electron application is a control-plane client, not a Docker
client. It has no Docker CLI, Docker SDK, Engine socket, Engine certificate, or
direct Engine endpoint. It calls the gateway using HTTPS and WebSocket only.

The gateway is the policy boundary. It authenticates the user, checks the
host-level grant, validates the request, writes audit metadata, and invokes a
connector for the selected host. The gateway must not expose a generic
`/proxy?url=` route or host-shell execution endpoint. The current in-memory
stores are a development slice; PostgreSQL/Redis-backed stores are required
before a production deployment.

## Host connection

Production host records use an HTTPS Docker Engine endpoint and server-side
mTLS material. The endpoint is an administrator-controlled value; client
certificates and private keys are encrypted by the configured secret store and
are never serialized into the public `Host` response.

Development can use a loopback HTTP endpoint or a Windows `npipe:` endpoint
from the gateway process. This is a server-side development convenience only.
The desktop renderer never receives or interprets the value.

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

If a host cannot be reached, the UI may display the last known host status but
must not execute mutations. A failed WebSocket resumes from its cursor when
possible; otherwise the client requests a fresh snapshot. A failed upstream
Engine request returns `502 engine_unavailable` without exposing stack traces,
certificate material, or upstream response bodies.
