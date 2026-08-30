import type { Host, ImageSummary } from "@harbor/contracts";

export interface ImageSecurityFacts {
  image: ImageSummary;
  /** Pinned to a content digest (sha256 RepoDigest) from the Engine. */
  digestPinned: boolean;
  /** The digest value, when present. */
  digest?: string;
  /** Image layers reported by the Engine, when inspect succeeded. */
  layerCount?: number;
  /** OS / architecture reported by the Engine image config. */
  os?: string;
  arch?: string;
  /** True when an inspect of the image is still loading. */
  inspectPending: boolean;
  /** True when the inspect request failed or has not run. */
  inspectUnavailable: boolean;
}

export interface SecurityGate {
  ok: boolean;
  message?: string;
}

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function isDigest(value: string | undefined): value is string {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

export function digestSuffix(value: string | undefined): string | undefined {
  return isDigest(value) ? value.slice(0, 19) + "…" : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Derives the read-only security facts for one image row. All facts come
 * from Engine data already fetched by the gateway; nothing is invented when
 * the Engine does not report a value.
 */
export function summarizeImageSecurity(
  image: ImageSummary,
  inspect: {
    data?: Record<string, unknown>;
    isPending?: boolean;
    isError?: boolean;
  },
): ImageSecurityFacts {
  const data: Record<string, unknown> = inspect.data ?? {};
  const config = asRecord(data.Config);
  const rootfs = asRecord(data.RootFS);
  const layers = Array.isArray(rootfs?.Layers)
    ? rootfs.Layers
    : Array.isArray(data.Layers)
      ? data.Layers
      : undefined;
  const repoDigests = Array.isArray(data.RepoDigests)
    ? data.RepoDigests
    : undefined;
  const digest =
    image.digest ?? asString(repoDigests?.[0]) ?? asString(data.Digest);
  return {
    image,
    digestPinned: isDigest(digest),
    ...(digest ? { digest } : {}),
    ...(layers && Array.isArray(layers) ? { layerCount: layers.length } : {}),
    ...(asString(config?.Os) ? { os: asString(config?.Os) } : {}),
    ...(asString(config?.Architecture)
      ? { arch: asString(config?.Architecture) }
      : {}),
    inspectPending: Boolean(inspect.isPending),
    inspectUnavailable:
      Boolean(inspect.isError) ||
      (!inspect.isPending && inspect.data === undefined),
  };
}

export function digestGate(facts: ImageSecurityFacts): {
  pass: SecurityGate;
  warn: SecurityGate;
} {
  if (facts.digestPinned) {
    return {
      pass: { ok: true },
      warn: {
        ok: false,
        message: "Pinned to a content digest — pulls are reproducible.",
      },
    };
  }
  return {
    pass: {
      ok: false,
      message:
        "No content digest is recorded for this image; re-tag it from a digested pull for reproducible deployments.",
    },
    warn: { ok: true },
  };
}

export function hostTrustFacts(host: Host | undefined) {
  if (!host) return undefined;
  return {
    host,
    connectionMode: host.connectionMode,
    developmentConnection: host.connectionMode !== "mtls",
    engineVersion: host.engineVersion,
    apiVersion: host.apiVersion,
    lastSeenAt: host.lastSeenAt,
  };
}

export function connectionModeSummary(mode: Host["connectionMode"]) {
  switch (mode) {
    case "mtls":
      return {
        label: "mTLS",
        detail:
          "Mutual TLS between the gateway and the Engine. Credentials are exchanged only during registration.",
      };
    case "development-http":
      return {
        label: "Development HTTP",
        detail:
          "Unencrypted Engine API used for local development. Move to mTLS before exposing this host outside a trusted network.",
      };
    case "development-socket":
      return {
        label: "Development socket",
        detail:
          "Engine over a local socket. Suitable for a single-machine setup; no encryption is involved.",
      };
    default:
      return {
        label: mode,
        detail: "Connection mode reported by the host record.",
      };
  }
}
