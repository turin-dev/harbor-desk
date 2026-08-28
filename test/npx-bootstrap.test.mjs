import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  extractChangelogSection,
  renderReleaseNotes,
} from "../scripts/generate-release-notes.mjs";
import {
  buildServerInstallPlan,
  formatServerInstallPlan,
  installServer,
  parseServerInstallArgs,
  serverPlatformSupport,
  serverInstallerPayload,
  serverInstallerUsage,
} from "../bin/server-installer.mjs";

const cliPath = fileURLToPath(
  new URL("../bin/harbor-desk.mjs", import.meta.url),
);
const manifestUrl = new URL("../package.json", import.meta.url);
const rendererIndexUrl = new URL(
  "../apps/desktop/dist/renderer/index.html",
  import.meta.url,
);
const desktopManifestUrl = new URL(
  "../apps/desktop/package.json",
  import.meta.url,
);
const gatewayManifestUrl = new URL(
  "../apps/gateway/package.json",
  import.meta.url,
);
const packageRoot = resolve(dirname(cliPath), "..");

function runCli(...arguments_) {
  return spawnSync(process.execPath, [cliPath, ...arguments_], {
    encoding: "utf8",
  });
}

test("prints the safe npx bootstrap contract by default", () => {
  const result = runCli();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Harbor Desk npx bootstrap/);
  assert.match(
    result.stdout,
    /does not access Docker Desktop, a local Docker socket/,
  );
  assert.match(
    result.stdout,
    /https:\/\/github\.com\/turin-dev\/harbor-desk\/releases/,
  );
  assert.match(result.stdout, /install-server --directory/);
});

test("reports the package manifest version", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const result = runCli("--version");

  assert.equal(manifest.bin?.["harbor-desk"], "bin/harbor-desk.mjs");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), manifest.version);
});

test("rejects unknown arguments without performing an action", () => {
  const result = runCli("--not-a-command");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown argument: --not-a-command/);
  assert.match(result.stderr, /Harbor Desk npx bootstrap/);
});

test("documents the explicit preview server installer without hiding socket risk", () => {
  const result = runCli("install-server", "--help");

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /controlled Linux, Windows, or macOS Docker host/,
  );
  assert.match(result.stdout, /--allow-local-engine-socket/);
  assert.match(result.stdout, /refuses non-empty directories or busy ports/);
  assert.match(serverInstallerUsage(), /Docker socket/);
});

test("parses an isolated server install plan and keeps it loopback-only", () => {
  const cwd = process.cwd();
  const options = parseServerInstallArgs(
    [
      "--directory",
      "./server-install",
      "--port",
      "4312",
      "--engine-name",
      "controlled local Docker Engine",
      "--allow-local-engine-socket",
      "--dry-run",
    ],
    { cwd },
  );
  const plan = buildServerInstallPlan(options, {
    root: cwd,
    version: "0.2.0-test",
  });

  assert.equal(options.directory, resolve(cwd, "server-install"));
  assert.equal(options.port, 4312);
  assert.equal(options.allowLocalEngineSocket, true);
  assert.equal(plan.healthUrl, "http://127.0.0.1:4312/health/live");
  assert.match(plan.environmentFile, /\.harbor-desk\.env$/);
  assert.ok(
    serverInstallerPayload.payloadPaths.includes(
      "server-payload/source/infra/compose",
    ),
    "the npm package must carry the Compose payload needed by install-server",
  );
});

test("requires an explicit destination and rejects malformed server options", () => {
  assert.throws(
    () => parseServerInstallArgs(["--allow-local-engine-socket"]),
    /--directory is required/,
  );
  assert.throws(
    () =>
      parseServerInstallArgs([
        "--directory",
        "./server-install",
        "--port",
        "70000",
      ]),
    /between 1 and 65535/,
  );
  assert.throws(
    () =>
      parseServerInstallArgs(["--directory", "./server-install", "--unknown"]),
    /Unknown install-server option: --unknown/,
  );
});

test("packs a minimal reproducible server payload for install-server", () => {
  const command =
    process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const arguments_ =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npm.cmd pack --dry-run --json"]
      : ["pack", "--dry-run", "--json"];
  const result = spawnSync(command, arguments_, {
    cwd: packageRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const [pack] = JSON.parse(result.stdout);
  const paths = new Set(pack.files.map((entry) => entry.path));
  const expected = [
    "bin/harbor-desk.mjs",
    "bin/server-installer.mjs",
    "server-payload/source/apps/gateway/src/server.ts",
    "server-payload/source/infra/compose/Dockerfile.gateway",
    "server-payload/source/pnpm-lock.yaml.txt",
  ];

  for (const path of expected) {
    assert.ok(paths.has(path), `missing ${path} from npm package`);
  }

  for (const path of paths) {
    assert.doesNotMatch(path, /(^|\/)(node_modules|dist)(\/|$)/);
    assert.doesNotMatch(path, /\.test\.(?:[cm]?[jt]s|tsx)$/);
  }

  assert.equal(
    existsSync(resolve(packageRoot, "server-payload")),
    false,
    "postpack must remove the generated payload from the source checkout",
  );
});

test("supports a server-side Docker host on Linux, Windows, and macOS", () => {
  for (const platform of ["linux", "win32", "darwin"]) {
    assert.ok(
      serverPlatformSupport(platform),
      `${platform} must be a supported server host`,
    );
  }

  assert.equal(serverPlatformSupport("aix"), undefined);
});

test("keeps the Engine socket an Engine-side POSIX path on every host", () => {
  // Windows path resolution would rewrite "/var/run/docker.sock" into
  // "C:\\var\\run\\docker.sock" and break the Compose bind source, so the
  // installer must never run the socket through host path resolution.
  for (const platform of ["linux", "win32", "darwin"]) {
    const options = parseServerInstallArgs(
      ["--directory", "./server-install", "--allow-local-engine-socket"],
      { cwd: process.cwd(), platform },
    );

    assert.equal(options.engineSocket, "/var/run/docker.sock");
    assert.equal(options.platform, platform);
  }
});

test("rejects an unsupported host and an unacknowledged Docker socket", async () => {
  const options = parseServerInstallArgs(
    [
      "--directory",
      "./server-install",
      "--allow-local-engine-socket",
      "--dry-run",
    ],
    { cwd: process.cwd(), platform: "linux" },
  );

  await assert.rejects(
    () =>
      installServer(options, {
        platform: "aix",
        version: "test",
        root: packageRoot,
        run: async () => {},
      }),
    /supports a controlled Docker host on Linux, Windows, macOS/,
  );

  await assert.rejects(
    () =>
      installServer(
        { ...options, allowLocalEngineSocket: false },
        {
          platform: "win32",
          version: "test",
          root: packageRoot,
          run: async () => {},
        },
      ),
    /Refusing to mount a Docker socket without --allow-local-engine-socket/,
  );
});

test("points the gateway at the in-container socket and reports the host platform", () => {
  const options = parseServerInstallArgs(
    ["--directory", "./server-install", "--port", "4321"],
    { cwd: process.cwd(), platform: "win32" },
  );
  const plan = buildServerInstallPlan(options, {
    root: process.cwd(),
    version: "0.3.0-test",
    platform: "win32",
  });

  assert.equal(plan.platform, "win32");
  assert.match(formatServerInstallPlan(plan), /Host platform: Windows/);
  assert.match(plan.healthUrl, /^http:\/\/127\.0\.0\.1:4321\//);
});

test("keeps the desktop artifact version aligned with the release version", async () => {
  // electron-builder names artifacts from the desktop manifest. If it drifts from
  // the published release version, a v0.3.0 release ships "Harbor-Desk-0.1.0-Setup.exe".
  const root = JSON.parse(await readFile(manifestUrl, "utf8"));
  const desktop = JSON.parse(await readFile(desktopManifestUrl, "utf8"));

  assert.equal(
    desktop.version,
    root.version,
    "apps/desktop version must match the release version used for artifact names",
  );

  for (const target of ["win", "linux", "mac"]) {
    assert.ok(
      desktop.build?.[target],
      `electron-builder must define a ${target} target so releases cover every client platform`,
    );
  }
});

test("packages and initializes the desktop-managed gateway before the renderer", async () => {
  const desktop = JSON.parse(await readFile(desktopManifestUrl, "utf8"));
  const gateway = JSON.parse(await readFile(gatewayManifestUrl, "utf8"));
  const main = await readFile(
    new URL("../apps/desktop/src/main/main.ts", import.meta.url),
    "utf8",
  );
  const managedGateway = await readFile(
    new URL("../apps/desktop/src/main/managed-gateway.ts", import.meta.url),
    "utf8",
  );

  assert.equal(desktop.dependencies?.["@harbor/gateway"], "workspace:*");
  assert.equal(desktop.dependencies?.["@harbor/config"], "workspace:*");
  assert.equal(gateway.exports?.["./app"]?.import, "./dist/app.js");
  assert.match(managedGateway, /from "@harbor\/gateway\/app"/);
  assert.match(managedGateway, /hostname !== "127\.0\.0\.1"/);
  assert.match(managedGateway, /randomBytes\(32\)\.toString\("base64url"\)/);

  const initializeIndex = main.indexOf("await initializeManagedGateway()");
  const createWindowIndex = main.indexOf(
    "await createWindow()",
    initializeIndex,
  );
  assert.ok(
    initializeIndex >= 0,
    "Electron must initialize the managed gateway",
  );
  assert.ok(
    createWindowIndex > initializeIndex,
    "the managed gateway must initialize before Electron creates the renderer window",
  );
  assert.match(
    main,
    /app\.on\("will-quit",[\s\S]*runtime\s*\.close\(\)/,
    "Electron must close the managed gateway after renderer windows begin shutting down",
  );
});

test("checks a fixed public release feed without downloading updates", async () => {
  const desktop = JSON.parse(await readFile(desktopManifestUrl, "utf8"));
  const main = await readFile(
    new URL("../apps/desktop/src/main/main.ts", import.meta.url),
    "utf8",
  );
  const checker = await readFile(
    new URL("../apps/desktop/src/main/update-checker.ts", import.meta.url),
    "utf8",
  );
  const preload = await readFile(
    new URL("../apps/desktop/src/preload.cts", import.meta.url),
    "utf8",
  );
  const renderer = await readFile(
    new URL("../apps/desktop/src/renderer/App.tsx", import.meta.url),
    "utf8",
  );
  const settings = await readFile(
    new URL(
      "../apps/desktop/src/renderer/screens/SettingsScreen.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.equal(desktop.dependencies?.["electron-updater"], undefined);
  assert.match(
    checker,
    /https:\/\/api\.github\.com\/repos\/turin-dev\/harbor-desk\/releases\?per_page=30/,
  );
  assert.match(checker, /application\/vnd\.github\+json/);
  assert.match(checker, /maximumResponseBytes/);
  assert.match(checker, /isTrustedUpdateReleaseUrl/);
  assert.doesNotMatch(
    `${checker}\n${main}\n${preload}`,
    /browser_download_url|autoDownload|downloadUpdate|quitAndInstall/,
    "the update checker must discover releases without downloading or executing assets",
  );
  assert.match(main, /ipcMain\.handle\("updates:check"/);
  assert.match(main, /ipcMain\.handle\("updates:open-release"/);
  assert.match(preload, /ipcRenderer\.invoke\(\s*"updates:check"/);
  assert.match(renderer, /manual: false/);
  assert.match(settings, /Automatically check for updates/);
  assert.match(settings, /never downloads or installs an update automatically/);
});

test("keeps packaged renderer assets relative to the file URL", async () => {
  const html = await readFile(rendererIndexUrl, "utf8");
  const references = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map(
    (match) => match[1],
  );
  const localReferences = references.filter(
    (reference) =>
      !/^[a-z][a-z\d+.-]*:/i.test(reference) && !reference.startsWith("//"),
  );

  assert.ok(
    localReferences.length >= 2,
    "the packaged renderer must load its JavaScript and stylesheet assets",
  );

  for (const reference of localReferences) {
    assert.ok(
      reference.startsWith("./"),
      `${reference} must be package-relative so Electron can load it through file://`,
    );
    assert.equal(
      existsSync(fileURLToPath(new URL(reference, rendererIndexUrl))),
      true,
      `${reference} must resolve to a file in the renderer bundle`,
    );
  }
});

test("packaging scripts build the workspace packages the renderer imports", async () => {
  // "pnpm --filter @harbor/desktop package:win" only builds the desktop app, so the
  // renderer fails with 'Failed to resolve entry for package "@harbor/ui"' on a clean
  // checkout. The root scripts must build dependencies first via the "..." selector.
  const root = JSON.parse(await readFile(manifestUrl, "utf8"));
  const desktop = JSON.parse(await readFile(desktopManifestUrl, "utf8"));
  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  for (const script of ["package:linux", "package:mac", "package:win"]) {
    const definition = root.scripts?.[script];

    assert.ok(definition, `root package.json must define ${script}`);
    assert.match(
      definition,
      /@harbor\/desktop\.\.\./,
      `${script} must build workspace dependencies before packaging`,
    );
  }

  assert.match(
    desktop.scripts?.["dev:electron"] ?? "",
    /@harbor\/desktop\^\.\.\./,
    "the clean-checkout Electron development command must build gateway and UI workspace dependencies first",
  );

  // The release workflow must call the root scripts, not the desktop-only ones.
  assert.match(workflow, /run: pnpm run \$\{\{ matrix\.script \}\}/);
  assert.doesNotMatch(
    workflow,
    /pnpm --filter @harbor\/desktop \$\{\{ matrix\.script \}\}/,
  );

  // macos-latest is arm64 in the current public runner set. Build macOS once on
  // each native host architecture so the release contains both x64 and arm64
  // installers instead of silently shipping only the runner's architecture.
  assert.match(workflow, /os: macos-15-intel[\s\S]*artifact: client-macos-x64/);
  assert.match(workflow, /os: macos-latest[\s\S]*artifact: client-macos-arm64/);
});

test("uses Node 24 artifact actions and distinguishes release tarballs from npm", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /actions\/upload-artifact@v7\b/);
  assert.match(workflow, /actions\/download-artifact@v8\b/);
  assert.doesNotMatch(
    workflow,
    /actions\/(?:upload|download)-artifact@v4\b/,
    "release jobs must not use the deprecated Node 20 artifact actions",
  );
  assert.match(workflow, /npm view "harbor-desk@\$\{version\}" version/);
  assert.match(workflow, /publish-npm:/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /npm 11\.5\.1 or newer/);
  assert.match(
    workflow,
    /npm publish[\s\S]*--access public[\s\S]*--tag preview[\s\S]*--provenance/,
  );
  assert.match(workflow, /npm publish "\.\/\$\{tarball\}"/);
  assert.match(workflow, /already published; refusing to overwrite it/);
  assert.match(workflow, /needs: \[verify, client, server, publish-npm\]/);
  assert.match(workflow, /NPM_PREVIEW_VERSION:/);
  assert.doesNotMatch(
    workflow,
    /NPM_TOKEN|NODE_AUTH_TOKEN/,
    "npm Trusted Publishing must not use a long-lived registry token",
  );
  assert.match(workflow, /node scripts\/generate-release-notes\.mjs/);
  assert.match(
    workflow,
    /cd release-assets[\s\S]*find \. -maxdepth 1 -type f ! -name SHA256SUMS -printf '%f\\0'/,
    "the checksum manifest must exclude itself and contain portable asset basenames",
  );
  assert.doesNotMatch(
    workflow,
    /sha256sum > release-assets\/SHA256SUMS/,
    "the checksum manifest must not record the CI staging directory",
  );
  assert.doesNotMatch(
    workflow,
    /Server: npm package for `npx --yes harbor-desk install-server`/,
    "an attached GitHub tarball is not the same as a published npm version",
  );
});

test("generates versioned release notes from the changelog and npm state", async () => {
  const changelog = await readFile(
    new URL("../CHANGELOG.md", import.meta.url),
    "utf8",
  );
  const changelogSection = extractChangelogSection(changelog, "0.3.1");

  assert.match(changelogSection, /Packaged desktop clients now load/);
  assert.doesNotMatch(changelogSection, /install-server now supports/);

  const unpublished = renderReleaseNotes({
    version: "0.3.1",
    changelogSection,
    npmLatestVersion: "0.2.0",
  });
  assert.match(unpublished, /#### Fixed/);
  assert.match(unpublished, /client-first desktop app/);
  assert.match(unpublished, /latest version was `v0\.2\.0`/);
  assert.match(unpublished, /checksums for every distributable asset/);
  assert.doesNotMatch(unpublished, /checksums for every attached asset/);
  assert.match(
    unpublished,
    /npx --yes --package \.\/harbor-desk-0\.3\.1\.tgz harbor-desk --version/,
  );
  assert.doesNotMatch(unpublished, /npx --yes harbor-desk@0\.3\.1/);

  const published = renderReleaseNotes({
    version: "0.3.1",
    changelogSection,
    npmReleaseVersion: "0.3.1",
    npmLatestVersion: "0.2.0",
    npmPreviewVersion: "0.3.1",
  });
  assert.match(published, /npm registry provides `v0\.3\.1`/);
  assert.match(published, /under the `preview` dist-tag/);
  assert.match(published, /default `latest` dist-tag is unchanged/);
  assert.match(published, /npx --yes harbor-desk@0\.3\.1 --version/);
});

test("ships a branded assisted Windows installer without changing upgrade identity", async () => {
  const desktop = JSON.parse(await readFile(desktopManifestUrl, "utf8"));
  const { nsis, win } = desktop.build;

  assert.equal(desktop.build.directories.buildResources, "build");
  assert.equal(win.icon, "build/icon.ico");
  assert.equal(nsis.guid, "021ca03c-a935-5711-b332-258afc345f2a");
  assert.equal(nsis.oneClick, false);
  assert.equal(nsis.perMachine, false);
  assert.equal(nsis.selectPerMachineByDefault, false);
  assert.equal(nsis.allowElevation, true);
  assert.equal(nsis.allowToChangeInstallationDirectory, true);
  assert.equal(nsis.createDesktopShortcut, true);
  assert.equal(nsis.createStartMenuShortcut, true);
  assert.equal(nsis.shortcutName, "Harbor Desk");
  assert.equal(nsis.runAfterFinish, true);
  assert.deepEqual(nsis.installerLanguages, ["en_US", "ko_KR"]);
  assert.equal(nsis.multiLanguageInstaller, true);
  assert.equal(nsis.displayLanguageSelector, false);
  assert.equal(nsis.installerIcon, "build/icon.ico");
  assert.equal(nsis.uninstallerIcon, "build/icon.ico");
  assert.equal(nsis.installerHeader, "build/installerHeader.bmp");
  assert.equal(nsis.installerSidebar, "build/installerSidebar.bmp");
  assert.equal(nsis.uninstallerSidebar, "build/uninstallerSidebar.bmp");
  assert.match(nsis.uninstallDisplayName, /Harbor Desk.*Preview/);
  assert.equal(nsis.warningsAsErrors, true);

  const icon = await readFile(
    new URL("../apps/desktop/build/icon.ico", import.meta.url),
  );
  assert.deepEqual([...icon.subarray(0, 4)], [0, 0, 1, 0]);
  assert.ok(
    icon.readUInt16LE(4) >= 7,
    "icon must include Windows sizes down to 16px",
  );

  for (const [name, width, height] of [
    ["installerHeader.bmp", 150, 57],
    ["installerSidebar.bmp", 164, 314],
    ["uninstallerSidebar.bmp", 164, 314],
  ]) {
    const bitmap = await readFile(
      new URL(`../apps/desktop/build/${name}`, import.meta.url),
    );
    assert.equal(bitmap.subarray(0, 2).toString("ascii"), "BM");
    assert.equal(bitmap.readInt32LE(18), width);
    assert.equal(bitmap.readInt32LE(22), height);
    assert.equal(
      bitmap.readUInt16LE(28),
      24,
      `${name} must be a 24-bit NSIS bitmap`,
    );
  }
});
