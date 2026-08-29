# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0 releases are
previews: the public API, gateway contracts, and packaging entry points can
still change between minor versions.

## [Unreleased]

### Added

- Container run options: the create dialog now supports published ports
  (container/host port plus protocol), environment variables, a restart
  policy, and labels, and the gateway validates all run-option input
  against the Engine create contract.
- Live image pull progress: pulls accept a client-generated operation id
  and the pull screen shows determinate progress with Engine status
  messages while polling the operation record every 2 seconds.
- Cancellable image pulls: while a pull is queued or running, the desktop
  Cancel button posts to the operation cancel endpoint and the gateway
  aborts the Engine request server-side, reporting the operation as
  `cancelled` without marking the remote host offline.
- Prune operations for containers, images, volumes, and networks via
  `POST /api/v1/hosts/{hostId}/prune/{kind}` (operator role, audited,
  returns a 202 operation record), with Prune dialogs on the Images,
  Volumes, and Networks screens and a clean-up action on Containers.
- An admin-only Audit log screen (`/audit`) rendering the gateway audit
  trail (actor, host, action, resource, result) with loading, error,
  empty, and non-admin permission states.

### Fixed

- The Troubleshoot screen can now retry a saved Gateway or Docker Engine target
  using the existing secure configuration, and successful retries refresh the
  active host/resource queries without requiring the user to re-enter mTLS data.
- The shared desktop status bar now exposes the same saved-connection retry
  action while the Gateway or Engine is unavailable, with duplicate retries
  coalesced into one connection attempt.
- The Hosts screen now distinguishes an unconfigured, unavailable, or failed
  host list from a reachable Gateway with no registered Engine hosts.

## [0.6.1] - 2026-08-29

### Fixed

- The Connections screen now exposes the initial connection button when no
  target is configured and opens the Gateway/Docker Engine registration dialog.
- Unavailable-connection guidance now points to the Connections screen instead
  of sending users to a settings page without an action.

## [0.6.0] - 2026-08-29

### Changed

- The desktop now accepts one Gateway or Docker Engine target and detects the
  connection type before creating the renderer. Server Gateways are used
  directly; raw Engine targets start a Local Gateway wrapper on a dynamic
  loopback port, so a Server Gateway and an unnecessary local Gateway are no
  longer started together.
- Connection settings, diagnostics, CSP, REST, and WebSocket routing now use
  the active Gateway uniformly. Remote raw Engines require HTTPS plus CA,
  client certificate, and private key material held by the Electron main
  process.

## [0.5.3] - 2026-08-29

### Added

- The default server-side `npm exec --yes harbor-desk` command now opens a
  keyboard-driven TUI when run from an interactive SSH session.
- The TUI supplies safe defaults, detects the server Docker socket as the
  common connection, keeps remote Engine mTLS as an advanced choice, validates
  the configuration, and prints SSH tunnel plus Gateway/WebSocket connection
  information after installation.
- `install` is now an alias for `install-server`; non-interactive sessions fail
  with explicit SSH guidance instead of waiting for input.

### Changed

- Server setup no longer opens a browser or requires users to assemble long
  installation arguments for the normal interactive path. Explicit options
  remain available for automation.

## [0.5.2] - 2026-08-29

### Added

- The server-side `npx harbor-desk install-server` flow now supports a remote
  Docker Engine over HTTPS mTLS with `--engine-endpoint`, CA, client
  certificate, and client private key file options.
- Remote Engine credentials stay on the server host and are mounted read-only
  into the gateway container without mounting a Docker socket. The interactive
  setup and `-AI` context describe both Engine transport choices.

### Security

- Remote Engine mode requires HTTPS and all three mTLS files, validates them
  before writing the install target, and rejects mixing remote mTLS with the
  privileged local Docker socket mount.

## [0.5.1] - 2026-08-28

### Added

- The server-side `npx harbor-desk install-server` flow now offers an
  interactive terminal setup for the destination, port, network binding,
  authentication mode, OIDC provider file, browser origins, and Docker socket
  acknowledgement.
- `-AI` and `--ai-context` now provide stable machine-readable setup context for
  non-interactive agents without reading Docker, touching the filesystem, or
  exposing provider credentials.
- The installer supports an explicit public preview binding with OIDC, HTTPS
  provider endpoint validation, narrow allowed origins, and protected generated
  environment settings while retaining loopback plus development authentication
  as the default.

### Security

- Public server preview setup rejects development authentication and requires
  OIDC configuration. TLS or reverse-proxy termination, firewall policy, and
  operational controls remain deployment responsibilities.

## [0.5.0] - 2026-08-28

### Added

- The desktop client checks the public Harbor Desk GitHub Releases metadata
  after startup and reports available updates in the shared shell. General
  settings can disable startup checks or exclude preview releases, and the
  status bar can trigger a manual refresh.
- Update checks run in the Electron main process behind a narrow preload API.
  The client opens only the fixed Harbor Desk release-tag page after a user
  action and never downloads or executes an installer automatically.

### Fixed

- Release checksum manifests now use portable asset basenames instead of the
  CI-only `release-assets/` staging path.

## [0.4.0] - 2026-08-28

### Added

- The desktop preview used a Fastify gateway on its default loopback endpoint
  before loading the interface and closed that runtime when the app quit.
- Each preview wrapper received a random per-launch desktop session token.
  Development authentication fails closed without that token even though the
  packaged `file://` renderer origin is allowed through CORS.

### Changed

- Harbor Desk's 0.4 preview followed a client-first startup flow: users
  launched one desktop app and then added Docker Engine connections without a
  separate gateway command. Explicit non-loopback configurations used an
  external gateway.
- Troubleshoot and About diagnostics reported whether the preview runtime was
  local, external, disabled, or unavailable without exposing its per-launch
  token.

### Fixed

- Release checksum generation now excludes `SHA256SUMS` itself, preventing the
  manifest from publishing an impossible self-referential hash.

## [0.3.2] - 2026-08-28

### Fixed

- The desktop shell now remains available after a restart or reload while the
  remote gateway is offline. Session bootstrap failures use the existing
  gateway-unavailable state instead of replacing the whole interface with a
  nearly blank error screen.

### Changed

- The Windows NSIS installer now uses Harbor Desk application, header, welcome,
  finish, and uninstaller artwork; bilingual English/Korean assisted setup;
  explicit shortcut, install-scope, destination, and finish behavior; and
  branded Add/Remove Programs metadata.
- The Windows application explicitly runs as the invoking user, while the
  installer keeps optional elevation limited to a user-selected all-users
  install. The NSIS GUID is pinned to the identity already shipped in v0.3.1 so
  custom branding does not break upgrades.
- Release artifact transfer now uses the current Node 24-based
  `actions/upload-artifact@v7` and `actions/download-artifact@v8` actions.
- Generated release notes now include the matching changelog section and report
  whether the tagged package is actually available from npm. An attached GitHub
  tarball is no longer described as though it were already npm-published.
- The README documents how to compare GitHub and npm versions and how to invoke
  a downloaded, checksum-verified release tarball explicitly.

## [0.3.1] - 2026-08-28

### Fixed

- Packaged desktop clients now load their renderer JavaScript, stylesheets,
  and fonts through package-relative `file://` URLs. Version 0.3.0 emitted
  root-relative `/assets/...` references, so Electron displayed only the
  window background after installation on Windows, Linux, and macOS.
- Added a release regression test that rejects root-relative renderer assets
  and verifies every local HTML asset reference exists in the built bundle.

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
  container image, packs the npm server installer, and publishes the client
  and server artifacts with SHA-256 checksums to a GitHub prerelease.
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
- Client packaging no longer fails on a clean checkout. The packaging scripts
  only built the desktop app, so the renderer aborted with `Failed to resolve
entry for package "@harbor/ui"` whenever no stale `dist/` output was present.
  The root `package:linux`, `package:mac`, and `package:win` scripts now build
  workspace dependencies first, and the release workflow calls those root scripts.
- Linux package metadata now includes the repository homepage and maintainer,
  allowing the `.deb` artifact to be generated on a clean release runner.
- macOS packaging now runs on both the native Intel and arm64 GitHub runners,
  so the release cannot silently omit one of the declared client architectures.

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

[Unreleased]: https://github.com/turin-dev/harbor-desk/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.6.1
[0.6.0]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.6.0
[0.5.3]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.5.3
[0.5.2]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.5.2
[0.5.1]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.5.1
[0.5.0]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.5.0
[0.4.0]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.4.0
[0.3.2]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.3.2
[0.3.1]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.3.1
[0.3.0]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.3.0
[0.2.0]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.2.0
[0.1.1]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.1.1
[0.1.0]: https://github.com/turin-dev/harbor-desk/releases/tag/v0.1.0
