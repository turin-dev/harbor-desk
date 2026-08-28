# Contributing to Harbor Desk

Thank you for improving Harbor Desk. This repository is an Apache-2.0 project
for a client-first remote container operations desktop app. Contributions should
make the implemented boundary clearer or stronger; they must not paper over
unfinished production work with fixture data or success-looking UI.

## Before you begin

- Search existing issues and discussions before opening a new one.
- Use an issue for a reproducible defect or a scoped proposal. Keep credentials,
  private host details, logs with tokens, and security reports out of public
  issues.
- Read SECURITY.md before reporting a vulnerability.
- Keep each pull request focused. Explain behavior changes, migration impact,
  and tests in the pull request template.

## Local setup

Use Node.js 22 or newer and pnpm 11.18.0. Run either:

```powershell
.\setup.ps1
```

or:

```bash
bash setup.sh
```

The setup scripts preserve an existing .env file and never start Docker or
deploy services. Configure real secrets outside the repository.

## Validation

Run the checks relevant to your change before requesting review:

```powershell
pnpm run check
pnpm test
pnpm run format:check
```

For a running Electron window, the optional long soak check also verifies the
main-process ID:

```powershell
$env:SOAK_DESKTOP_PID = "<Electron main-process ID>"
pnpm run soak:8h
```

Build, test, or a static review does not replace a real remote-host,
authentication, packaged-artifact, or deployment acceptance check. State
clearly what you did and did not exercise.

## Security and architecture rules

- The renderer and preload boundary must not gain Docker CLI, Docker SDK,
  Docker socket, filesystem-secret, or direct Engine access.
- All Engine requests stay behind the gateway, where authentication,
  authorization, host grants, request validation, and auditing are enforced.
- The desktop-managed gateway must remain loopback-only, and protected requests
  must fail closed without its random per-launch token. Never log or persist
  that token.
- Do not add a generic URL proxy, arbitrary host-shell endpoint, or a way to
  forward raw Engine credentials to a desktop client.
- Treat Docker socket access as privileged. A read-only mount does not make
  Docker API operations read-only.
- Do not commit .env files, certificate/key files, tokens, passwords, or
  deployment-specific host information.
- Mark incomplete capabilities unavailable instead of simulating success.

## Code and documentation

Use TypeScript, keep contracts explicit, and prefer small focused changes.
Update tests and user-facing documentation when behavior or a security boundary
changes. Keep license notices intact. By contributing, you agree that your
contribution is provided under Apache-2.0.

## Conduct

All participants are expected to follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
