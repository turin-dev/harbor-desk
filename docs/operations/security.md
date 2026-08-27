# Security boundary checklist

- Production gateway binds behind TLS and uses `AUTH_MODE=oidc`.
- Plain Docker Engine TCP access is not a supported production transport.
- Production host registration requires HTTPS, CA/client certificate/client
  key material, and a configured `ENGINE_ENDPOINT_ALLOWLIST`.
- Production startup requires an injected Vault/KMS-backed secret store; the
  in-memory AES-GCM fallback is restricted to development and tests.
- The browser/renderer cannot access Node.js, filesystem secrets, or Docker.
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
- File uploads are validated before entering a worker or remote Engine request.
- External extension and AI actions are policy-gated; neither receives an
  unrestricted gateway or host shell.
- The gateway does not reveal upstream stack traces or raw Engine errors.
- Rate limits apply to every API route and stricter limits apply to expensive
  search, scan, build, and AI operations.
