# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0 releases are
previews: the public API, gateway contracts, and packaging entry points can
still change between minor versions.

## Unreleased

### Added

- `NOTICE` file with the Apache-2.0 attribution notice and an explicit
  statement that the project is independent of Docker, Inc.
- `.editorconfig` so contributor editors match the repository formatting rules.
- Dependabot configuration for npm, GitHub Actions, and Compose images, with
  Electron major upgrades held back for manual security review.
- `CODEOWNERS` review routing for the gateway, connectors, contracts, Electron
  main/preload boundary, packaging scripts, infrastructure, and policy files.
- Issue-template chooser that routes vulnerability reports to private security
  advisories instead of public issues.
- Pull-request dependency review in CI for high-severity dependency changes.

### Changed

- CI now runs the format, build/type-check, test, and `npm pack --dry-run`
  checks on both `ubuntu-latest` and `windows-latest`, with per-workflow
  concurrency, job timeouts, and checkout credentials not persisted.
- `LICENSE` restored to the unmodified Apache-2.0 text so license detection and
  redistribution obligations are unambiguous; the project copyright line now
  lives in `NOTICE`.

## [0.2.0] - 2026-08-27

### Added

- `npx --yes harbor-desk install-server` for a controlled Linux Docker host.
- A minimal, lockfile-backed gateway source payload built through Docker Compose.
- Loopback-only port binding, generated per-install server secret, refusal of a
  non-empty target directory or occupied port, and a required acknowledgement
  before mounting the privileged local Docker socket.

## [0.1.1] - 2026-08-27

### Added

- `npx --yes harbor-desk` as a safe bootstrap that prints source, release, and
  server-overlay links without installing or launching the desktop application,
  downloading the unsigned installer, or touching a Docker daemon.

## [0.1.0] - 2026-08-27

### Added

- First open-source, source-only preview: Electron/React/TypeScript/MUI desktop
  shell, Fastify `/api/v1` gateway, remote host registry and Engine connector,
  OIDC + PKCE boundary, host-scoped RBAC, idempotent operations, audit metadata,
  and a cursor-resumable event stream.
- Open-source documentation, safe setup scripts, contribution and security
  policies, issue templates, and CI.

[0.2.0]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.2.0
[0.1.1]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.1.1
[0.1.0]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.1.0
