# Security boundary checklist

- Production gateway binds behind TLS and uses `AUTH_MODE=oidc`.
- `npx harbor-desk install-server` defaults to exact loopback (`127.0.0.1`) and
  development authentication. A public bind (`--public` or
  `--bind-host 0.0.0.0`) is rejected unless OIDC and a valid provider file are
  supplied.
- Public preview provider endpoints must use HTTPS, and the published gateway
  port must still sit behind TLS or a reverse proxy plus a firewall. Public bind
  is network reachability, not production readiness.
- The installer can print a machine-readable `-AI` setup context. It contains
  commands and trust-boundary information only; provider contents and
  credentials are never included in that output or the formatted install plan.
- The desktop-managed preview gateway binds only to exact `127.0.0.1`, starts
  before the renderer, and stops when the desktop process quits.
- Protected managed-gateway requests require a random per-launch
  `x-harbor-desktop-token`; the token is never persisted or included in
  diagnostics. Allowing `Origin: null` is valid only with this token guard.
- Automatic startup is never used for HTTPS, LAN, or remote gateway URLs.
- Plain Docker Engine TCP access is not a supported production transport.
- Production host registration requires HTTPS, CA/client certificate/client
  key material, and a configured `ENGINE_ENDPOINT_ALLOWLIST`.
- Production startup requires an injected Vault/KMS-backed secret store; the
  in-memory AES-GCM fallback is restricted to development and tests.
- The browser/renderer cannot access Node.js, filesystem secrets, or Docker.
- The managed token is a loopback channel guard, not user authentication or
  process isolation; production still requires OIDC and the external gateway
  controls listed here.
- Host endpoint registration rejects embedded credentials.
- Host-level RBAC is enforced server-side for every resource and action route.
- In OIDC mode, administrators see all registered hosts; viewer/operator
  identities are restricted to IDs from `hostIdsClaim` (or conventional
  `harbor_host_ids` / `host_ids` claims). Missing grants produce an empty host
  set, and the renderer host selector is never treated as a security boundary.
- Destructive actions require explicit UI confirmation and are audited.
- Request IDs are returned in error envelopes and written to server logs.
- Container mutations use operation IDs and `Idempotency-Key`; implemented
  mutation and terminal-session metadata is recorded without terminal output.
- Tokens, mTLS private keys, Compose secrets, and provider credentials are
  redacted from logs.
- The standalone installer writes its generated environment file with owner-only
  permissions on platforms that support POSIX modes; it never prints the file.
- File uploads are validated before entering a worker or remote Engine request.
- External extension and AI actions are policy-gated; neither receives an
  unrestricted gateway or host shell.
- The gateway does not reveal upstream stack traces or raw Engine errors.
- Rate limits apply to every API route and stricter limits apply to expensive
  search, scan, build, and AI operations.
