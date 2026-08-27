[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -LiteralPath $PSCommandPath -Parent
Set-Location -LiteralPath $repoRoot

$nodeCommand = Get-Command -Name node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "Node.js 22 or newer is required."
}

$nodeVersion = (& $nodeCommand.Source -p "process.versions.node").Trim()
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 22) {
  throw "Node.js 22 or newer is required; found $nodeVersion."
}

if (-not (Test-Path -LiteralPath ".env" -PathType Leaf)) {
  Copy-Item -LiteralPath ".env.example" -Destination ".env"
  Write-Host "Created .env from .env.example. Replace development placeholders before deployment."
} else {
  Write-Host "Preserved existing .env."
}

$pnpmCommand = Get-Command -Name pnpm -ErrorAction SilentlyContinue
if ($pnpmCommand) {
  & $pnpmCommand.Source install --frozen-lockfile
} else {
  $corepackCommand = Get-Command -Name corepack -ErrorAction SilentlyContinue
  if (-not $corepackCommand) {
    throw "pnpm 11.18.0 (or Corepack) is required."
  }
  & $corepackCommand.Source pnpm install --frozen-lockfile
}

Write-Host "Dependencies are installed. This script did not start Docker, expose ports, or deploy services."
