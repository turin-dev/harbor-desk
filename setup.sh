#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$repo_root"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required." >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 22 ]; then
  echo "Node.js 22 or newer is required; found $(node --version)." >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Replace development placeholders before deployment."
else
  echo "Preserved existing .env."
fi

if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile
elif command -v corepack >/dev/null 2>&1; then
  corepack pnpm install --frozen-lockfile
else
  echo "pnpm 11.18.0 (or Corepack) is required." >&2
  exit 1
fi

echo "Dependencies are installed. This script did not start Docker, expose ports, or deploy services."
