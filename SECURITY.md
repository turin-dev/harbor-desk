# Security policy

## Reporting a vulnerability

Do not post an unpatched vulnerability, exploit details, credentials, or
deployment-specific host information in a public issue.

Use the repository's private reporting form at
<https://github.com/turin-dev/harbor-desk/security/advisories/new>. Include the
affected version or commit, the trust boundary involved, reproduction steps, and
the observed impact. Maintainers aim to acknowledge a report within 7 days,
share an assessment within 30 days, and coordinate disclosure before publishing
a fix. If the private form is unavailable, open a minimal public issue that asks
for a private channel and contains no technical detail.

## Supported scope

The latest 0.x preview on `main` is the supported source line; older preview
tags do not receive backported fixes. It is not a production-ready hosted
service or a promise that every visible screen has an implemented backend.
Unsupported capabilities intentionally surface an unavailable state.

| Version                      | Supported |
| ---------------------------- | --------- |
| Latest 0.x preview on `main` | Yes       |
| Earlier 0.x preview tags     | No        |

## Security model

- The Electron renderer is not a Docker client. It has no Docker CLI, Engine
  SDK, socket, client certificate, private key, or direct Engine endpoint.
- The Fastify gateway is the policy boundary. It authenticates users, applies
  server-side host grants and roles, validates requests, records audit
  metadata, and invokes the selected server-side connector.
- Production Engine records require HTTPS, mTLS material held server side, and
  an explicit endpoint allowlist. Embedded endpoint credentials are rejected.
- Production startup must use OIDC, TLS, and an injected Vault/KMS-backed
  secret store. The in-memory encrypted store is development/test-only and
  must fail closed in production.
- Tokens, mTLS material, provider credentials, and Compose secrets must be
  redacted from logs. Avoid adding raw upstream error bodies or stack traces to
  API responses.

## Docker socket warning

The optional local-engine Compose overlay is intentionally a server-side
development fixture. Binding a Docker socket into a gateway container grants
powerful control of the Docker host. The read-only mount flag only protects the
socket mount itself; it does not restrict Docker API methods.

Use the overlay only on a controlled development or private-preview machine.
Never expose the Docker socket, do not publish the preview gateway directly to
the Internet, and do not use this arrangement as production security
isolation.

## Deployment prerequisites not yet complete

Before treating a deployment as production-ready, complete and operate durable
PostgreSQL/Redis-backed stores, host-grant persistence, a production
Vault/KMS adapter, production worker processing, authentication/authorization
acceptance checks, secret rotation, monitoring, backups, signed packages, and
an independent security review. The absence of a public advisory does not make
an unreviewed deployment safe.
