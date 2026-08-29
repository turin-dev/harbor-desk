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
  SDK, socket, or direct Engine transport. A user can submit an endpoint and
  mTLS material through the host-registration form, but the gateway stores and
  uses those values and never returns them in a `Host` response.
- The Electron main process probes the configured target before it creates the
  renderer window. A detected Server Gateway is used directly. A detected raw
  Docker Engine starts a wrapper on exactly `127.0.0.1` with an OS-assigned
  port; that wrapper never binds to a LAN interface and does not start a Docker
  daemon.
- Each Local Gateway wrapper requires a cryptographically random per-launch
  `x-harbor-desktop-token`. This protects the loopback API when CORS permits the
  packaged renderer's opaque `file://` origin (`Origin: null`). The token is
  kept in the main process, exposed only through the narrow preload API needed
  to attach requests, and excluded from diagnostics and logs.
- The Fastify gateway is the policy boundary. It authenticates users, applies
  server-side host grants and roles, validates requests, records audit
  metadata, and invokes the selected server-side connector.
- Raw local Engine targets may use `localhost`, `127.0.0.1`, `npipe:`, or
  `unix:`. Raw remote Engines must use HTTPS and all three CA/client
  certificate/private-key values. Plain HTTP remote Engines are rejected.
- A previously detected Server Gateway remains a Server Gateway when it is
  temporarily offline; the client reports `unavailable` and does not create a
  second Local Gateway wrapper.
- Update checks are metadata-only requests from the Electron main process to
  the fixed public GitHub Releases API. No gateway token, Engine endpoint, host
  metadata, or authentication credential is attached; the `User-Agent` contains
  only the product name and current semantic version. Drafts and malformed tags
  are ignored, response size and request time are bounded, and the preload
  returns only typed status. The renderer cannot supply an arbitrary release
  URL: opening an update is restricted to this repository's HTTPS release-tag
  path. Harbor Desk never downloads or executes an update automatically.
- Production Engine records require HTTPS, mTLS material held server side, and
  an explicit endpoint allowlist. Embedded endpoint credentials are rejected.
- Production startup must use OIDC, TLS, and an injected Vault/KMS-backed
  secret store. The in-memory encrypted store is development/test-only and
  must fail closed in production.
- Tokens, mTLS material, provider credentials, and Compose secrets must be
  redacted from logs. Avoid adding raw upstream error bodies or stack traces to
  API responses.

The Local Gateway wrapper is a convenience for raw Engine connections, not
process isolation or a production deployment. Renderer compromise can use the
narrow preload API as the legitimate renderer can; the per-launch token is a
loopback channel guard, not a substitute for OIDC, host authorization, endpoint
allowlisting, durable secrets, or operating-system isolation.

## Docker socket warning

The optional local-engine Compose overlay is intentionally a server-side
development fixture. Binding a Docker socket into a gateway container grants
powerful control of the Docker host. The read-only mount flag only protects the
socket mount itself; it does not restrict Docker API methods.

Use the overlay only on a controlled development or private-preview machine.
Never expose the Docker socket, do not publish the preview gateway directly to
the Internet, and do not use this arrangement as production security
isolation.

This applies identically on Linux, Windows, and macOS. On Docker Desktop the
socket bind source is resolved inside the Docker Linux virtual machine, which
does not reduce its privilege: a container holding that socket can still control
the Engine and therefore other containers on that host.

## Release artifact signing

Release workflow artifacts are unsigned unless the build environment supplies
signing material. An unsigned installer cannot prove origin or integrity, so
macOS Gatekeeper and Windows SmartScreen will warn. Verify the checksum against
the release page, and do not distribute an unsigned artifact as a trusted
production build.

An update-available notification is not a trust decision. The current checker
opens the release page only; users must still verify the release source,
signature when available, and `SHA256SUMS` before running an installer.

## Deployment prerequisites not yet complete

Before treating a deployment as production-ready, complete and operate durable
PostgreSQL/Redis-backed stores, host-grant persistence, a production
Vault/KMS adapter, production worker processing, authentication/authorization
acceptance checks, secret rotation, monitoring, backups, signed packages, and
an independent security review. The absence of a public advisory does not make
an unreviewed deployment safe.

## Known unpatched advisories

Dependabot, secret scanning with push protection, and CodeQL default setup are
enabled on this repository. One advisory currently has no upstream fix:

- **extract-zip 2.0.1 — unvalidated symlink path traversal (high).** It reaches
  the tree only as a transitive dependency of the `electron` development
  dependency, which uses it to unpack the prebuilt Electron binary at install
  time. Version 2.0.1 is the newest release, so no patched version is available.
  It is not part of the published npm package, is not loaded by the gateway or
  the renderer at runtime, and is not reachable from remote input. Treat it as a
  build-host supply-chain risk: build from a trusted registry mirror and do not
  run installs on untrusted archives. This entry will be removed once an
  upstream fix or an Electron release without the dependency is available.
