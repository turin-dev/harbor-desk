import { Buffer } from "node:buffer";

export const updateReleasesApi =
  "https://api.github.com/repos/turin-dev/harbor-desk/releases?per_page=30";
const releasePageBase =
  "https://github.com/turin-dev/harbor-desk/releases/tag/";
const maximumResponseBytes = 1_000_000;

export type UpdateCheckState =
  "idle" | "checking" | "available" | "up-to-date" | "error";

export interface UpdateCheckStatus {
  state: UpdateCheckState;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  checkedAt?: string;
  message: string;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string>;
  normalized: string;
}

interface GitHubRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

export interface CheckForUpdatesOptions {
  currentVersion: string;
  includePrerelease?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

function parseVersion(value: string): ParsedVersion | undefined {
  if (value.length > 128) return undefined;
  const match = value.match(
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
  if (!match) return undefined;

  const core = match.slice(1, 4).map(Number);
  if (core.some((part) => !Number.isSafeInteger(part))) return undefined;
  const prerelease = match[4]?.split(".") ?? [];
  if (
    prerelease.some(
      (identifier) => /^\d+$/.test(identifier) && /^0\d+/.test(identifier),
    )
  )
    return undefined;

  const [major, minor, patch] = core as [number, number, number];
  return {
    major,
    minor,
    patch,
    prerelease,
    normalized: `${major}.${minor}.${patch}${
      prerelease.length ? `-${prerelease.join(".")}` : ""
    }`,
  };
}

function comparePrerelease(left: Array<string>, right: Array<string>): number {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const leftNumber = Number(leftPart);
      const rightNumber = Number(rightPart);
      if (
        !Number.isSafeInteger(leftNumber) ||
        !Number.isSafeInteger(rightNumber)
      )
        return leftPart.length === rightPart.length
          ? leftPart < rightPart
            ? -1
            : 1
          : leftPart.length < rightPart.length
            ? -1
            : 1;
      return leftNumber < rightNumber ? -1 : 1;
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function compareParsedVersions(
  left: ParsedVersion,
  right: ParsedVersion,
): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function compareSemanticVersions(
  left: string,
  right: string,
): number | undefined {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) return undefined;
  return compareParsedVersions(parsedLeft, parsedRight);
}

function checkedAt(options: CheckForUpdatesOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}

function errorStatus(
  options: CheckForUpdatesOptions,
  message: string,
): UpdateCheckStatus {
  return {
    state: "error",
    currentVersion: options.currentVersion,
    checkedAt: checkedAt(options),
    message,
  };
}

export function initialUpdateStatus(currentVersion: string): UpdateCheckStatus {
  return {
    state: "idle",
    currentVersion,
    message: "Updates have not been checked yet.",
  };
}

export async function checkForUpdates(
  options: CheckForUpdatesOptions,
): Promise<UpdateCheckStatus> {
  const current = parseVersion(options.currentVersion);
  if (!current)
    return errorStatus(
      options,
      "This client version cannot be compared with published releases.",
    );

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(updateReleasesApi, {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": `Harbor-Desk/${current.normalized}`,
        "x-github-api-version": "2026-03-10",
      },
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch {
    return errorStatus(
      options,
      "Could not contact GitHub Releases. Check the network and try again.",
    );
  }

  if (!response.ok)
    return errorStatus(
      options,
      `GitHub Releases returned HTTP ${response.status}. Try again later.`,
    );

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumResponseBytes)
    return errorStatus(options, "The update response was unexpectedly large.");

  let releases: unknown;
  try {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > maximumResponseBytes)
      return errorStatus(
        options,
        "The update response was unexpectedly large.",
      );
    releases = JSON.parse(body) as unknown;
  } catch {
    return errorStatus(options, "GitHub returned invalid release metadata.");
  }

  if (!Array.isArray(releases))
    return errorStatus(options, "GitHub returned invalid release metadata.");

  const candidates = releases
    .map((value) => {
      if (!value || typeof value !== "object") return undefined;
      const release = value as GitHubRelease;
      if (
        release.draft === true ||
        (release.prerelease === true && !options.includePrerelease) ||
        typeof release.tag_name !== "string"
      )
        return undefined;
      const version = parseVersion(release.tag_name);
      if (!version) return undefined;
      return {
        tagName: release.tag_name,
        version,
      };
    })
    .filter((candidate) => candidate !== undefined)
    .sort((left, right) => compareParsedVersions(right.version, left.version));

  const latest = candidates[0];
  const timestamp = checkedAt(options);
  if (!latest)
    return {
      state: "up-to-date",
      currentVersion: current.normalized,
      checkedAt: timestamp,
      message: options.includePrerelease
        ? "No compatible releases are published yet."
        : "No stable releases are published yet.",
    };

  if (compareParsedVersions(latest.version, current) <= 0)
    return {
      state: "up-to-date",
      currentVersion: current.normalized,
      latestVersion: latest.version.normalized,
      checkedAt: timestamp,
      message: `Harbor Desk ${current.normalized} is up to date.`,
    };

  return {
    state: "available",
    currentVersion: current.normalized,
    latestVersion: latest.version.normalized,
    releaseUrl: `${releasePageBase}${encodeURIComponent(latest.tagName)}`,
    checkedAt: timestamp,
    message: `Harbor Desk ${latest.version.normalized} is available.`,
  };
}

export function isTrustedUpdateReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const pathPrefix = "/turin-dev/harbor-desk/releases/tag/";
    if (!url.pathname.startsWith(pathPrefix)) return false;
    const encodedTag = url.pathname.slice(pathPrefix.length);
    if (!encodedTag || encodedTag.includes("/")) return false;
    const tag = decodeURIComponent(encodedTag);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.search === "" &&
      url.hash === "" &&
      parseVersion(tag) !== undefined
    );
  } catch {
    return false;
  }
}
