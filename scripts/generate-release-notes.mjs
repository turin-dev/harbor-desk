import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const changelogUrl = new URL("../CHANGELOG.md", import.meta.url);

export function extractChangelogSection(changelog, version) {
  const lines = changelog.replaceAll("\r\n", "\n").split("\n");
  const heading = `## [${version}]`;
  const start = lines.findIndex(
    (line) => line === heading || line.startsWith(`${heading} - `),
  );

  if (start === -1) {
    throw new Error(`CHANGELOG.md does not contain a ${heading} section.`);
  }

  const nextSection = lines.findIndex(
    (line, index) => index > start && /^## \[[^\]]+\]/.test(line),
  );
  const section = lines
    .slice(start + 1, nextSection === -1 ? undefined : nextSection)
    .join("\n")
    .trim();

  if (!section) {
    throw new Error(`${heading} must describe at least one release change.`);
  }

  return section;
}

function nestChangelogHeadings(section) {
  return section.replace(/^(#{1,5})(\s+)/gm, "#$1$2");
}

export function renderReleaseNotes({
  version,
  changelogSection,
  npmReleaseVersion = "",
  npmLatestVersion = "",
}) {
  if (!version?.trim()) {
    throw new Error("A release version is required.");
  }

  const normalizedVersion = version.trim().replace(/^v/, "");
  const releaseTag = `v${normalizedVersion}`;
  const tarball = `harbor-desk-${normalizedVersion}.tgz`;
  const registryHasRelease = [npmReleaseVersion, npmLatestVersion]
    .map((value) => value.trim().replace(/^v/, ""))
    .includes(normalizedVersion);

  let npmStatus;
  if (registryHasRelease) {
    npmStatus = `The npm registry provides \`${releaseTag}\`. To run that exact version instead of following the latest dist-tag:\n\n\`\`\`bash\nnpx --yes harbor-desk@${normalizedVersion} --version\n\`\`\``;
  } else {
    const registryDetail = npmLatestVersion.trim()
      ? `At release time, the npm registry's latest version was \`v${npmLatestVersion.trim().replace(/^v/, "")}\`, so an unpinned \`npx --yes harbor-desk\` command will not fetch \`${releaseTag}\`.`
      : `The release workflow could not confirm that \`${releaseTag}\` was available from the npm registry.`;

    npmStatus = `${registryDetail}\n\nAfter downloading and verifying the attached tarball, run it explicitly:\n\n\`\`\`bash\nnpx --yes --package ./${tarball} harbor-desk --version\n\`\`\``;
  }

  return `## Harbor Desk ${releaseTag} preview

This preview contains the remote-first desktop client and the server-side Docker gateway installer.

### Changes

${nestChangelogHeadings(changelogSection)}

### Downloads

- **Windows:** x64 NSIS installer and blockmap
- **Linux:** x86_64 AppImage and Debian package
- **macOS:** x64 and arm64 DMG/ZIP packages and blockmaps
- **Server:** attached GitHub release tarball \`${tarball}\`
- **Integrity:** \`SHA256SUMS\` contains SHA-256 checksums for every attached asset

### npm distribution

${npmStatus}

### Preview and security boundaries

This remains a prerelease. Desktop binaries are currently **unsigned**; verify \`SHA256SUMS\` before installation and use a source build where signed artifacts are required.

The desktop client remains remote-first and does not require a local Docker Engine. The server installer supports controlled Linux, Windows, and macOS Docker hosts, but requires explicit \`--allow-local-engine-socket\` acknowledgement before mounting a host's Docker Engine socket.

See [\`SECURITY.md\`](https://github.com/turin-dev/harbor-desk/blob/${releaseTag}/SECURITY.md) for the current security and dependency-advisory boundary.`;
}

async function main() {
  const version = process.env.RELEASE_VERSION?.trim();
  if (!version) {
    throw new Error("RELEASE_VERSION is required.");
  }

  const changelog = await readFile(changelogUrl, "utf8");
  const notes = renderReleaseNotes({
    version,
    changelogSection: extractChangelogSection(changelog, version),
    npmReleaseVersion: process.env.NPM_RELEASE_VERSION,
    npmLatestVersion: process.env.NPM_LATEST_VERSION,
  });

  process.stdout.write(`${notes}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
