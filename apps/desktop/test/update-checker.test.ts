import assert from "node:assert/strict";
import test from "node:test";
import {
  checkForUpdates,
  compareSemanticVersions,
  isTrustedUpdateReleaseUrl,
  updateReleasesApi,
} from "../src/main/update-checker.js";

const fixedNow = new Date("2026-08-28T12:00:00.000Z");

function releaseResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("compares stable and prerelease semantic versions", () => {
  assert.equal(compareSemanticVersions("0.4.0", "0.4.0"), 0);
  assert.equal(compareSemanticVersions("v0.5.0", "0.4.9"), 1);
  assert.equal(compareSemanticVersions("1.0.0-beta.2", "1.0.0-beta.11"), -1);
  assert.equal(compareSemanticVersions("1.0.0-beta", "1.0.0"), -1);
  assert.equal(compareSemanticVersions("1.0.0+build.2", "1.0.0+build.1"), 0);
  assert.equal(compareSemanticVersions("1.0", "1.0.0"), undefined);
  assert.equal(compareSemanticVersions("1.0.0-01", "1.0.0"), undefined);
});

test("selects the highest published release and sends bounded GitHub headers", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const fetchImpl = (async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return releaseResponse([
      { tag_name: "v99.0.0", draft: true, prerelease: false },
      { tag_name: "not-a-version", draft: false, prerelease: false },
      { tag_name: "v0.5.0-beta.1", draft: false, prerelease: true },
      { tag_name: "v0.4.2", draft: false, prerelease: false },
    ]);
  }) as typeof fetch;

  const result = await checkForUpdates({
    currentVersion: "0.4.0",
    includePrerelease: true,
    fetchImpl,
    now: () => fixedNow,
  });

  assert.equal(requestedUrl, updateReleasesApi);
  assert.equal(requestedInit?.method, "GET");
  assert.equal(requestedInit?.redirect, "error");
  assert.deepEqual(requestedInit?.headers, {
    accept: "application/vnd.github+json",
    "user-agent": "Harbor-Desk/0.4.0",
    "x-github-api-version": "2026-03-10",
  });
  assert.deepEqual(result, {
    state: "available",
    currentVersion: "0.4.0",
    latestVersion: "0.5.0-beta.1",
    releaseUrl:
      "https://github.com/turin-dev/harbor-desk/releases/tag/v0.5.0-beta.1",
    checkedAt: fixedNow.toISOString(),
    message: "Harbor Desk 0.5.0-beta.1 is available.",
  });
});

test("keeps preview releases out of the stable channel", async () => {
  const fetchImpl = (async () =>
    releaseResponse([
      { tag_name: "v0.6.0-beta.1", draft: false, prerelease: true },
      { tag_name: "v0.5.0", draft: false, prerelease: false },
    ])) as typeof fetch;

  const result = await checkForUpdates({
    currentVersion: "0.4.0",
    includePrerelease: false,
    fetchImpl,
    now: () => fixedNow,
  });

  assert.equal(result.state, "available");
  assert.equal(result.latestVersion, "0.5.0");
});

test("reports a successful check when no release exists for the channel", async () => {
  const result = await checkForUpdates({
    currentVersion: "0.4.0",
    includePrerelease: false,
    fetchImpl: (async () =>
      releaseResponse([
        { tag_name: "v0.5.0-beta.1", draft: false, prerelease: true },
      ])) as typeof fetch,
    now: () => fixedNow,
  });

  assert.equal(result.state, "up-to-date");
  assert.equal(result.latestVersion, undefined);
  assert.match(result.message, /No stable releases/);
});

test("does not downgrade a newer local client", async () => {
  const result = await checkForUpdates({
    currentVersion: "0.6.0",
    includePrerelease: true,
    fetchImpl: (async () =>
      releaseResponse([
        { tag_name: "v0.5.0", draft: false, prerelease: false },
      ])) as typeof fetch,
    now: () => fixedNow,
  });

  assert.equal(result.state, "up-to-date");
  assert.equal(result.latestVersion, "0.5.0");
});

test("fails closed for malformed versions and release responses", async () => {
  let fetched = false;
  const invalidVersion = await checkForUpdates({
    currentVersion: "development",
    fetchImpl: (async () => {
      fetched = true;
      return releaseResponse([]);
    }) as typeof fetch,
    now: () => fixedNow,
  });
  assert.equal(fetched, false);
  assert.equal(invalidVersion.state, "error");

  const invalidBody = await checkForUpdates({
    currentVersion: "0.4.0",
    fetchImpl: (async () =>
      new Response("not json", { status: 200 })) as typeof fetch,
    now: () => fixedNow,
  });
  assert.equal(invalidBody.state, "error");
  assert.match(invalidBody.message, /invalid release metadata/);

  const oversized = await checkForUpdates({
    currentVersion: "0.4.0",
    fetchImpl: (async () =>
      new Response("x".repeat(1_000_001), { status: 200 })) as typeof fetch,
    now: () => fixedNow,
  });
  assert.equal(oversized.state, "error");
  assert.match(oversized.message, /unexpectedly large/);
});

test("turns HTTP and transport failures into non-blocking status", async () => {
  const unavailable = await checkForUpdates({
    currentVersion: "0.4.0",
    fetchImpl: (async () => {
      throw new Error("offline");
    }) as typeof fetch,
    now: () => fixedNow,
  });
  assert.equal(unavailable.state, "error");
  assert.match(unavailable.message, /Could not contact GitHub/);

  const rateLimited = await checkForUpdates({
    currentVersion: "0.4.0",
    fetchImpl: (async () =>
      new Response("{}", { status: 403 })) as typeof fetch,
    now: () => fixedNow,
  });
  assert.equal(rateLimited.state, "error");
  assert.match(rateLimited.message, /HTTP 403/);
});

test("opens only the fixed repository release-tag path", () => {
  assert.equal(
    isTrustedUpdateReleaseUrl(
      "https://github.com/turin-dev/harbor-desk/releases/tag/v0.5.0",
    ),
    true,
  );
  assert.equal(
    isTrustedUpdateReleaseUrl(
      "https://github.com/turin-dev/harbor-desk/releases/tag/v0.5.0?download=1",
    ),
    false,
  );
  assert.equal(
    isTrustedUpdateReleaseUrl(
      "https://github.com.evil.test/turin-dev/harbor-desk/releases/tag/v9.0.0",
    ),
    false,
  );
  assert.equal(
    isTrustedUpdateReleaseUrl(
      "https://github.com/turin-dev/another-repo/releases/tag/v9.0.0",
    ),
    false,
  );
  assert.equal(
    isTrustedUpdateReleaseUrl(
      "https://github.com/turin-dev/harbor-desk/releases/tag/v1.0.0/extra",
    ),
    false,
  );
  assert.equal(
    isTrustedUpdateReleaseUrl(
      "https://user@github.com/turin-dev/harbor-desk/releases/tag/v1.0.0",
    ),
    false,
  );
});
