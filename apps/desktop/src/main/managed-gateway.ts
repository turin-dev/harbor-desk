import { randomBytes } from "node:crypto";
import { buildApp, type HarborApp } from "@harbor/gateway/app";
import { loadGatewayConfig } from "@harbor/config";

const healthPath = "/health/live";
const providersPath = "/api/v1/auth/providers";

export interface LocalEngineTarget {
  endpoint: string;
  displayName: string;
  ca?: string;
  cert?: string;
  key?: string;
}

export interface LocalGatewayRuntime {
  url: string;
  sessionToken: string;
  engineHostId: string;
  engineOnline: boolean;
  close: () => Promise<void>;
}

export interface LocalGatewayOptions {
  engine: LocalEngineTarget;
  gatewayVersion: string;
  sessionToken?: string;
  env?: NodeJS.ProcessEnv;
}

function originForEndpoint(endpoint: string): string | undefined {
  try {
    const url = new URL(endpoint);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function isHttpEndpoint(endpoint: string): boolean {
  try {
    const protocol = new URL(endpoint).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function isGatewayHealthBody(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== "object") return false;
  const health = data as {
    status?: unknown;
    version?: unknown;
    dependencies?: unknown;
  };
  return (
    typeof health.version === "string" &&
    (health.status === "ok" || health.status === "degraded") &&
    Boolean(health.dependencies && typeof health.dependencies === "object")
  );
}

export async function probeHarborGateway(
  endpoint: string,
  timeoutMs = 1_500,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const origin = originForEndpoint(endpoint);
  if (!origin) return false;

  try {
    const healthResponse = await fetchImpl(`${origin}${healthPath}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!healthResponse.ok) return false;
    const healthBody = (await healthResponse.json().catch(() => undefined)) as
      unknown | undefined;
    if (!isGatewayHealthBody(healthBody)) return false;

    const providersResponse = await fetchImpl(`${origin}${providersPath}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!providersResponse.ok) return false;
    const providersBody = (await providersResponse
      .json()
      .catch(() => undefined)) as { data?: unknown } | undefined;
    return Boolean(providersBody?.data && Array.isArray(providersBody.data));
  } catch {
    return false;
  }
}

function gatewayConfig(options: LocalGatewayOptions) {
  const env = options.env ?? process.env;
  const config = loadGatewayConfig({
    ...env,
    NODE_ENV: "development",
    AUTH_MODE: "dev",
    HOST: "127.0.0.1",
    PORT: "0",
    GATEWAY_VERSION: options.gatewayVersion,
    ALLOWED_ORIGINS: [
      "null",
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ].join(","),
  });
  config.desktopSessionToken =
    options.sessionToken ?? randomBytes(32).toString("base64url");
  config.devEngineHost = options.engine.endpoint;
  config.devEngineDisplayName = options.engine.displayName;
  config.devEngineTls = {
    ca: options.engine.ca,
    cert: options.engine.cert,
    key: options.engine.key,
  };
  return config;
}

export async function startLocalEngineGateway(
  options: LocalGatewayOptions,
): Promise<LocalGatewayRuntime> {
  const config = gatewayConfig(options);
  let harbor: HarborApp | undefined;
  try {
    harbor = await buildApp(config);
    await harbor.app.listen({ host: "127.0.0.1", port: 0 });
    const address = harbor.app.server.address();
    if (!address || typeof address === "string")
      throw new Error("The local Gateway wrapper did not expose a port.");

    const host = harbor.registry
      .list()
      .find((candidate) => candidate.id === "dev-remote-engine");
    if (!host)
      throw new Error("The local Gateway wrapper did not register the Engine.");

    const url = `http://127.0.0.1:${address.port}`;
    const running = harbor;
    let closed = false;
    return {
      url,
      sessionToken: config.desktopSessionToken!,
      engineHostId: host.id,
      engineOnline: host.status === "online",
      close: async () => {
        if (closed) return;
        closed = true;
        await running.app.close();
      },
    };
  } catch (error) {
    await harbor?.app.close().catch(() => undefined);
    throw new Error("The local Gateway wrapper could not start.", {
      cause: error,
    });
  }
}
