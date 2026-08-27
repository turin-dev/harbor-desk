import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { FastifyRequest } from "fastify";
import type {
  AuthProvider,
  CurrentUser,
  PermissionSet,
  Role,
} from "@harbor/contracts";
import type { GatewayConfig, OidcProviderConfig } from "@harbor/config";
import { HttpError } from "../errors.js";

function asRole(value: unknown): Role | undefined {
  return value === "viewer" || value === "operator" || value === "admin"
    ? value
    : undefined;
}

function stringListFromClaim(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/)
      : [];
  const result = [
    ...new Set(
      values
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  return result;
}

function roleFromClaims(payload: JWTPayload, roleClaim?: string): Role {
  const direct = asRole(roleClaim ? payload[roleClaim] : payload.role);
  if (direct) return direct;

  const claims = [
    roleClaim ? payload[roleClaim] : undefined,
    payload.role,
    payload.groups,
    payload.roles,
  ]
    .flatMap((value) =>
      Array.isArray(value) ? value : typeof value === "string" ? [value] : [],
    )
    .map((value) => String(value).toLowerCase());

  if (claims.some((value) => value === "admin" || value.endsWith(":admin")))
    return "admin";
  if (
    claims.some((value) => value === "operator" || value.endsWith(":operator"))
  )
    return "operator";
  return "viewer";
}

function hostIdsFromClaims(
  payload: JWTPayload,
  hostIdsClaim?: string,
): string[] | undefined {
  const claim = hostIdsClaim
    ? payload[hostIdsClaim]
    : (payload.harbor_host_ids ?? payload.host_ids);
  return stringListFromClaim(claim);
}

export class AuthService {
  private readonly jwks = new Map<
    string,
    ReturnType<typeof createRemoteJWKSet>
  >();
  private readonly websocketTickets = new Map<
    string,
    { user: CurrentUser; expiresAt: number }
  >();

  constructor(private readonly config: GatewayConfig) {}

  public providers(): AuthProvider[] {
    return this.config.oidcProviders.map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      issuer: provider.issuer,
      authorizationEndpoint: provider.authorizationEndpoint,
      scopes: provider.scopes,
    }));
  }

  public authorizationUrl(
    providerId: string,
    input: {
      redirectUri: string;
      state: string;
      nonce: string;
      codeChallenge: string;
    },
  ): string {
    const provider = this.provider(providerId);
    this.assertDesktopRedirect(input.redirectUri);
    const url = new URL(
      provider.authorizationEndpoint ??
        `${provider.issuer.replace(/\/$/, "")}/authorize`,
    );
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", provider.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set(
      "scope",
      provider.scopes.join(" ") || "openid profile email",
    );
    url.searchParams.set("state", input.state);
    url.searchParams.set("nonce", input.nonce);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  public async exchangeCode(input: {
    providerId: string;
    code: string;
    redirectUri: string;
    codeVerifier?: string;
    nonce?: string;
    refreshToken?: string;
  }): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    tokenType?: string;
  }> {
    const provider = this.provider(input.providerId);
    this.assertDesktopRedirect(input.redirectUri);
    const tokenEndpoint =
      provider.tokenEndpoint ?? `${provider.issuer.replace(/\/$/, "")}/token`;
    const body = new URLSearchParams(
      input.refreshToken
        ? {
            grant_type: "refresh_token",
            refresh_token: input.refreshToken,
            client_id: provider.clientId,
          }
        : {
            grant_type: "authorization_code",
            code: input.code,
            redirect_uri: input.redirectUri,
            client_id: provider.clientId,
            code_verifier: input.codeVerifier ?? "",
          },
    );
    if (provider.clientSecret) body.set("client_secret", provider.clientSecret);

    let response: Response;
    try {
      response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new HttpError(
        502,
        "oidc_unavailable",
        "The identity provider could not be reached.",
        { retryable: true },
      );
    }
    if (!response.ok)
      throw new HttpError(
        502,
        "oidc_token_exchange_failed",
        "The identity provider rejected the token exchange.",
      );
    const payload = (await response.json().catch(() => undefined)) as
      Record<string, unknown> | undefined;
    if (!payload || typeof payload.access_token !== "string")
      throw new HttpError(
        502,
        "oidc_invalid_token_response",
        "The identity provider returned an invalid token response.",
      );
    if (!input.refreshToken) {
      if (typeof payload.id_token !== "string")
        throw new HttpError(
          502,
          "oidc_missing_id_token",
          "The identity provider did not return an OpenID Connect identity token.",
        );
      const identity = await this.verify(provider, payload.id_token);
      if (typeof input.nonce !== "string" || identity.nonce !== input.nonce)
        throw new HttpError(
          401,
          "oidc_nonce_mismatch",
          "The identity provider nonce did not match the login transaction.",
        );
    }
    return {
      accessToken: payload.access_token,
      refreshToken:
        typeof payload.refresh_token === "string"
          ? payload.refresh_token
          : input.refreshToken,
      expiresIn:
        typeof payload.expires_in === "number" ? payload.expires_in : undefined,
      tokenType:
        typeof payload.token_type === "string" ? payload.token_type : undefined,
    };
  }

  public async authenticate(
    request: FastifyRequest,
  ): Promise<CurrentUser | undefined> {
    if (this.config.authMode === "dev") {
      return {
        id: "dev-user",
        displayName: "Development operator",
        email: "dev@localhost",
        role: "admin",
      };
    }

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) return undefined;
    const token = authorization.slice("Bearer ".length).trim();
    if (!token) return undefined;

    for (const provider of this.config.oidcProviders) {
      try {
        const payload = await this.verify(provider, token);
        const hostIds = hostIdsFromClaims(payload, provider.hostIdsClaim);
        return {
          id: String(payload.sub ?? "oidc-user"),
          displayName: String(
            payload.name ?? payload.preferred_username ?? payload.sub ?? "User",
          ),
          email: typeof payload.email === "string" ? payload.email : undefined,
          role: roleFromClaims(payload, provider.roleClaim),
          ...(hostIds ? { hostIds } : {}),
        };
      } catch {
        // A token can only be accepted if one configured issuer verifies it.
      }
    }

    return undefined;
  }

  public isDevelopmentAuth(): boolean {
    return this.config.authMode === "dev";
  }

  public async requireUser(request: FastifyRequest): Promise<CurrentUser> {
    const user = await this.authenticate(request);
    if (!user) {
      throw new HttpError(401, "unauthorized", "Authentication is required.", {
        retryable: false,
      });
    }
    return user;
  }

  public issueWebSocketTicket(user: CurrentUser): string {
    const ticket = randomUUID();
    this.websocketTickets.set(ticket, {
      user,
      expiresAt: Date.now() + 60_000,
    });
    return ticket;
  }

  public authenticateWebSocket(
    request: FastifyRequest,
    ticket?: string,
  ): Promise<CurrentUser | undefined> {
    if (ticket) {
      const issued = this.websocketTickets.get(ticket);
      this.websocketTickets.delete(ticket);
      if (issued && issued.expiresAt > Date.now())
        return Promise.resolve(issued.user);
    }
    return this.authenticate(request);
  }

  public permissions(user: CurrentUser, hostIds: string[]): PermissionSet {
    const actions =
      user.role === "viewer"
        ? ["read"]
        : user.role === "operator"
          ? [
              "read",
              "container.lifecycle",
              "container.exec",
              "image.manage",
              "compose.run",
              "build.run",
            ]
          : ["*"];

    const visibleHostIds =
      this.config.authMode === "dev" || user.role === "admin"
        ? hostIds
        : hostIds.filter((hostId) => user.hostIds?.includes(hostId));
    return { role: user.role, hostIds: visibleHostIds, actions };
  }

  public assertRole(user: CurrentUser, minimum: Role): void {
    const ranks: Record<Role, number> = { viewer: 1, operator: 2, admin: 3 };
    if (ranks[user.role] < ranks[minimum]) {
      throw new HttpError(
        403,
        "forbidden",
        "You do not have permission for this action.",
      );
    }
  }

  private async verify(
    provider: OidcProviderConfig,
    token: string,
  ): Promise<JWTPayload> {
    let keySet = this.jwks.get(provider.id);
    if (!keySet) {
      const jwksUri =
        provider.jwksUri ??
        `${provider.issuer.replace(/\/$/, "")}/.well-known/jwks.json`;
      keySet = createRemoteJWKSet(new URL(jwksUri));
      this.jwks.set(provider.id, keySet);
    }

    const result = await jwtVerify(token, keySet, {
      issuer: provider.issuer,
      audience: [provider.audience, provider.clientId],
    });
    return result.payload;
  }

  private provider(providerId: string): OidcProviderConfig {
    const provider = this.config.oidcProviders.find(
      (candidate) => candidate.id === providerId,
    );
    if (!provider)
      throw new HttpError(
        404,
        "oidc_provider_not_found",
        "The selected identity provider was not configured.",
      );
    for (const endpoint of [
      provider.issuer,
      provider.authorizationEndpoint,
      provider.tokenEndpoint,
      provider.jwksUri,
    ]) {
      if (!endpoint) continue;
      let url: URL;
      try {
        url = new URL(endpoint);
      } catch {
        throw new HttpError(
          503,
          "oidc_provider_invalid",
          "The configured identity provider has an invalid endpoint.",
        );
      }
      if (this.config.nodeEnv === "production" && url.protocol !== "https:") {
        throw new HttpError(
          503,
          "oidc_provider_insecure",
          "Production identity providers must use HTTPS endpoints.",
        );
      }
    }
    return provider;
  }

  private assertDesktopRedirect(redirectUri: string): void {
    if (redirectUri !== "harbor-desk://auth/callback") {
      throw new HttpError(
        400,
        "invalid_redirect_uri",
        "Only the Harbor Desk desktop callback is allowed.",
      );
    }
  }
}
