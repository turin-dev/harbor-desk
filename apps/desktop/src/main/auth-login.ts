import { createHash } from "node:crypto";

export const OIDC_REDIRECT_URI = "harbor-desk://auth/callback";

const providerIdPattern = /^[a-zA-Z0-9._-]{1,128}$/;

export function isValidProviderId(providerId: string): boolean {
  return providerIdPattern.test(providerId);
}

export interface PkceMaterial {
  verifier: string;
  state: string;
  nonce: string;
}

export function deriveCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthorizeUrl(
  gatewayUrl: string,
  providerId: string,
  material: PkceMaterial,
): string {
  const authorize = new URL(
    `/api/v1/auth/authorize/${encodeURIComponent(providerId)}`,
    gatewayUrl,
  );
  authorize.searchParams.set("redirectUri", OIDC_REDIRECT_URI);
  authorize.searchParams.set("state", material.state);
  authorize.searchParams.set("nonce", material.nonce);
  authorize.searchParams.set(
    "codeChallenge",
    deriveCodeChallenge(material.verifier),
  );
  return authorize.toString();
}

export interface ParsedAuthCallback {
  code?: string;
  state?: string;
}

export function parseAuthCallback(
  rawUrl: string,
): ParsedAuthCallback | undefined {
  let callback: URL;
  try {
    callback = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (
    callback.protocol !== "harbor-desk:" ||
    callback.hostname !== "auth" ||
    callback.pathname !== "/callback"
  )
    return undefined;
  return {
    code: callback.searchParams.get("code") ?? undefined,
    state: callback.searchParams.get("state") ?? undefined,
  };
}
