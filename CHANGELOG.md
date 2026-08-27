# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0 releases are
previews: the public API, gateway contracts, and packaging entry points can
still change between minor versions.

## [0.3.0] - 2026-08-27

### Added

- `install-server` now supports a Linux, Windows, or macOS Docker host instead
  of Linux only. Verified end to end on Windows with Docker Desktop: the gateway
  container started, reported `engine: ok`, and listed the real Docker Engine
  29.6.2 (API 1.55) as an online host.
- Desktop client packaging targets for all three platforms: AppImage and deb on
  Linux, NSIS on Windows, and dmg and zip (x64 and arm64) on macOS.
- A `Release` workflow that verifies the tagged commit, builds the client on
  `ubuntu-latest`, `windows-latest`, and `macos-latest`, builds the gateway
  container image, and packs the npm server installer.
- A "Supported platforms" README section covering both the server and client
  matrix and the unsigned-artifact warning.

### Fixed

- The installer no longer runs the Engine socket through host path resolution.
  On Windows this rewrote `/var/run/docker.sock` into `C:\var\run\docker.sock`
  and produced an invalid Compose bind source. The socket is resolved by the
  Docker Engine, so it stays a POSIX path on every host.
- The gateway now dials the socket at its pinned in-container path rather than
  the host-side source, so a non-default `--engine-socket` cannot desynchronize
  `DEV_ENGINE_HOST` from the actual mount target.
- `sudo` is no longer attempted on Windows, which has no `sudo`; the installer
  reports the real Docker Compose availability problem instead.
- The desktop manifest version was `0.1.0` while the release was `0.2.0`, so a
  `v0.2.0` build produced `Harbor-Desk-0.1.0-Setup.exe`. Both manifests are now
  `0.3.0` and a test plus a release-workflow tag check keep them aligned.

### Repository and CI

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
- `SECURITY.md` section recording the one known unpatched advisory
  (`extract-zip` reached through the Electron build dependency) with its
  reachability assessment.

### Changed

- CI now runs the format, build/type-check, test, and `npm pack --dry-run`
  checks on both `ubuntu-latest` and `windows-latest`, with per-workflow
  concurrency, job timeouts, and checkout credentials not persisted.
- `LICENSE` restored to the unmodified Apache-2.0 text so license detection and
  redistribution obligations are unambiguous; the project copyright line now
  lives in `NOTICE`.
- `SECURITY.md` now points at the private security-advisory form, states
  acknowledgement and assessment targets, and lists supported versions.

### Security

- Enabled Dependabot alerts and security updates, secret scanning with push
  protection, private vulnerability reporting, and CodeQL default setup.
- Upgraded Electron to 39.8.10, which cleared 6 high-severity and 20 lower
  severity advisories.
- Protected `main` with a ruleset requiring both CI matrix checks and blocking
  branch deletion and force pushes.

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

[0.3.0]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.3.0
[0.2.0]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.2.0
[0.1.1]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.1.1
[0.1.0]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.1.0
