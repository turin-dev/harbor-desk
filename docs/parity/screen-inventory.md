# Docker Desktop 4.84.0 parity inventory

The local installation used for reference is Docker Desktop
`4.84.0.234817` on Windows. Capture reference screenshots at fixed window sizes
before changing the token set.

## UI stack baseline

The desktop renderer uses the same broad stack as the local Docker Desktop
reference: React, Electron, MUI primitives, and Roboto/Roboto Mono. Harbor Desk
keeps its own application components and brand mark, while sharing the
reference's measurable design rules through `@harbor/ui`:

- 8px spacing unit with 32px horizontal and 16px vertical page padding.
- Roboto for interface text and Roboto Mono for terminal/code content.
- Docker blue, grey, green, amber, red, and violet light/dark semantic tokens.
- Four-pixel control radius, border-first surfaces, and elevation-free cards.
- Navigation, terminal, focus, and status colors are theme tokens rather than
  screen-local hex values.

No Docker proprietary UI assets are copied into the client.

## Desktop runtime acceptance

The visual shell is accepted only when all of the following are true in an
actual Electron window, not merely in a browser tab:

- The Electron preload is emitted as CommonJS and loaded successfully by the
  sandboxed renderer.
- Development CSP permits the Vite React preamble while keeping the production
  renderer isolated through Electron context isolation, sandboxing, and a
  Docker-socket-free preload boundary.
- Both localhost and 127.0.0.1 Vite origins are accepted by the local gateway
  CORS allowlist, so the Electron default URL can establish a session.
- The native Windows menu bar is hidden by default; the app retains its own
  navigation and tray restoration paths.
- The renderer root has visible content and a captured page contains the
  shared navigation, top bar, and current surface rather than only the window
  background.
- The long-run soak checks the selected Electron main-process PID together
  with the gateway and renderer endpoints. A prior PID or a background-only
  HTTP probe is not sufficient evidence of a working desktop window.

## Shared shell

- Permanent left navigation with grouped resource areas
- Header quick search
- Remote host/context switcher
- Notifications and settings controls
- Quick search over live resources, with keyboard navigation and `Ctrl+K`
- Integrated terminal drawer
- Empty, loading, offline, permission denied, and unsupported states
- Light, dark, and system themes
- Keyboard focus and accessible labels

## Surfaces

| Surface        | First implementation state                                                        | Production adapter               |
| -------------- | --------------------------------------------------------------------------------- | -------------------------------- |
| Dashboard      | Live host summary                                                                 | Docker Engine + event hub        |
| Containers     | Live list, filter, run/create+start, lifecycle, inspect, logs, stats, exec output | Docker Engine                    |
| Images         | Live list, filter, inspect, remove                                                | Docker Engine + Registry         |
| Volumes        | Live list, filter, create, inspect, admin delete                                  | Docker Engine + object storage   |
| Networks       | Live list, filter, create, inspect, delete                                        | Docker Engine                    |
| Builds         | Shell and state model                                                             | BuildKit worker                  |
| Compose        | Shell and state model                                                             | Server-side Compose worker       |
| Kubernetes     | Shell and state model                                                             | Kubernetes connector             |
| Extensions     | Shell and state model                                                             | OCI catalog and sandbox policy   |
| Registry       | Shell and state model                                                             | Hub/OCI adapter                  |
| Image security | Shell and state model                                                             | Trivy/Grype worker               |
| Assistant      | Shell and state model                                                             | User-selected LLM adapter        |
| Settings       | Remote-native general settings                                                    | Gateway configuration and policy |
| Troubleshoot   | Live gateway, host, API, and capability diagnostics                               | Gateway/host diagnostics         |
| About          | Client/gateway versions and redacted diagnostics                                  | Client runtime                   |

No screen may report a successful action from fixture data. A surface is
production-ready only when its adapter returns real data or an explicit,
capability-based unavailable state.
