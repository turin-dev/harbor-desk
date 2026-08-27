# Harbor Desk contributor context

This file gives coding assistants and contributors the repository constraints
that must survive every change.

## Product boundary

Harbor Desk is a remote-first desktop control plane. The Electron renderer and
preload boundary are not Docker clients. They must not acquire a Docker CLI,
Docker SDK, Docker socket, Engine certificate, direct Engine endpoint, or
filesystem access to deployment secrets.

All Docker Engine communication is mediated by the Fastify gateway. The gateway
is responsible for authentication, server-side host authorization, request
validation, audit metadata, capability checks, and connector calls. A UI host
selector is never a security boundary.

## Local-engine fixture

The local-engine Compose overlay is a server-side development-only fixture. It
may mount a Docker socket into the gateway container. Socket access is
privileged even when the filesystem mount is marked read-only; the read-only
flag does not constrain Docker API actions. Do not turn the fixture into a
client-local fallback or describe it as production isolation.

`install-server` runs on a Linux, Windows, or macOS Docker host. The Engine
socket path is interpreted by the Docker Engine, not by the host shell, so it
must stay a POSIX path such as `/var/run/docker.sock` on every platform. Never
pass it through host path resolution: on Windows that yields
`C:\var\run\docker.sock` and breaks the Compose bind source.

## Development rules

- Use Node.js 22+ and pnpm 11.18.0.
- Keep generated output, node_modules, real .env files, certificate/key files,
  logs, and deployment-specific information out of version control.
- Preserve explicit unavailable states for unfinished capabilities. Do not
  replace them with fixtures or fake-success responses.
- Preserve the production fail-closed secret-store behavior. Do not add a
  default in-memory production secret store.
- When a change affects a route, authorization, secret handling, or Engine
  connector, update tests and the security/architecture documentation.
- Do not create a public repository, publish an artifact, or push a branch
  without explicit maintainer approval.

## Verification

Run the narrowest useful check first, then the repository checks before
handoff:

```powershell
pnpm run check
pnpm test
pnpm run format:check
```

Report unverified external assumptions separately from successful local checks.
