export interface OidcProviderConfig {
  id: string;
  displayName: string;
  issuer: string;
  audience: string;
  clientId: string;
  roleClaim?: string;
  hostIdsClaim?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  jwksUri?: string;
  clientSecret?: string;
  scopes: string[];
}

export interface GatewayConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  gatewayVersion: string;
  allowedOrigins: string[];
  authMode: "dev" | "oidc";
  oidcProviders: OidcProviderConfig[];
  engineEndpointAllowlist: string[];
  devEngineHost?: string;
  devEngineDisplayName?: string;
  devEngineTls?: {
    caFile?: string;
    certFile?: string;
    keyFile?: string;
  };
  secretMasterKey?: string;
  databaseUrl?: string;
  redisUrl?: string;
  objectStorageEndpoint?: string;
}

function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function asNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseProviders(raw: string | undefined): OidcProviderConfig[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((provider): provider is OidcProviderConfig => {
        if (!provider || typeof provider !== "object") return false;
        const item = provider as Record<string, unknown>;
        return (
          typeof item.id === "string" &&
          typeof item.displayName === "string" &&
          typeof item.issuer === "string" &&
          typeof item.audience === "string" &&
          typeof item.clientId === "string"
        );
      })
      .map((provider) => ({
        ...provider,
        scopes: Array.isArray(provider.scopes)
          ? provider.scopes.filter(
              (scope): scope is string => typeof scope === "string",
            )
          : ["openid", "profile", "email"],
      }));
  } catch {
    return [];
  }
}

export function loadGatewayConfig(
  env: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const nodeEnv = (env.NODE_ENV ?? "development") as GatewayConfig["nodeEnv"];
  const providers = parseProviders(env.OIDC_PROVIDERS_JSON);
  const authMode =
    env.AUTH_MODE === "oidc" || nodeEnv === "production" ? "oidc" : "dev";

  return {
    nodeEnv,
    host: env.HOST ?? "127.0.0.1",
    port: asNumber(env.PORT, 4310),
    gatewayVersion: env.GATEWAY_VERSION ?? "0.1.0",
    allowedOrigins: (
      env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173"
    )
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    authMode,
    oidcProviders: providers,
    engineEndpointAllowlist: (env.ENGINE_ENDPOINT_ALLOWLIST ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    devEngineHost: env.DEV_ENGINE_HOST || undefined,
    devEngineDisplayName: env.DEV_ENGINE_DISPLAY_NAME?.trim() || undefined,
    devEngineTls: {
      caFile: env.DEV_ENGINE_CA_FILE || undefined,
      certFile: env.DEV_ENGINE_CERT_FILE || undefined,
      keyFile: env.DEV_ENGINE_KEY_FILE || undefined,
    },
    secretMasterKey: env.SECRET_MASTER_KEY || undefined,
    databaseUrl: env.DATABASE_URL || undefined,
    redisUrl: env.REDIS_URL || undefined,
    objectStorageEndpoint: env.OBJECT_STORAGE_ENDPOINT || undefined,
  };
}

export { asBoolean };
