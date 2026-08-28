import { randomBytes } from "node:crypto";
import { buildApp, type HarborApp } from "@harbor/gateway/app";
import { loadGatewayConfig } from "@harbor/config";

const healthPath = "/health/live";

export type ManagedGatewayState =
  "managed" | "external" | "disabled" | "unavailable";

export interface ManagedGatewayStatus {
  state: ManagedGatewayState;
  url: string;
  message: string;
}

export interface ManagedGatewayRuntime {
  status: ManagedGatewayStatus;
  sessionToken?: string;
  close: () => Promise<void>;
}

export interface ManagedGatewayOptions {
  gatewayUrl: string;
  gatewayVersion: string;
  disabled?: boolean;
  sessionToken?: string;
  probeTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ManagedGatewayTarget {
  host: "127.0.0.1";
  port: number;
  origin: string;
}

export function managedGatewayTarget(
  gatewayUrl: string,
): ManagedGatewayTarget | undefined {
  let url: URL;
  try {
    url = new URL(gatewayUrl);
  } catch {
    return undefined;
  }

  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return undefined;

  const port = Number(url.port || "80");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;

  return { host: "127.0.0.1", port, origin: url.origin };
}

async function isHarborGatewayReachable(
  origin: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const response = await fetch(`${origin}${healthPath}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    const body = (await response.json().catch(() => undefined)) as
      { data?: { version?: unknown; status?: unknown } } | undefined;
    return (
      typeof body?.data?.version === "string" &&
      (body.data.status === "ok" || body.data.status === "degraded")
    );
  } catch {
    return false;
  }
}

function closedRuntime(status: ManagedGatewayStatus): ManagedGatewayRuntime {
  return { status, close: () => Promise.resolve() };
}

export async function startManagedGateway(
  options: ManagedGatewayOptions,
): Promise<ManagedGatewayRuntime> {
  const target = managedGatewayTarget(options.gatewayUrl);
  if (!target)
    return closedRuntime({
      state: "external",
      url: options.gatewayUrl,
      message:
        "The configured gateway remains external; automatic startup is limited to a 127.0.0.1 HTTP root URL.",
    });

  if (options.disabled)
    return closedRuntime({
      state: "disabled",
      url: target.origin,
      message: "Automatic gateway startup is disabled.",
    });

  if (
    await isHarborGatewayReachable(target.origin, options.probeTimeoutMs ?? 750)
  )
    return closedRuntime({
      state: "external",
      url: target.origin,
      message: "An existing Harbor Desk gateway is already listening.",
    });

  const sessionToken =
    options.sessionToken ?? randomBytes(32).toString("base64url");
  const env = options.env ?? process.env;
  const config = loadGatewayConfig({
    ...env,
    NODE_ENV: "development",
    AUTH_MODE: "dev",
    HOST: target.host,
    PORT: String(target.port),
    GATEWAY_VERSION: options.gatewayVersion,
    ALLOWED_ORIGINS: [
      "null",
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ].join(","),
  });
  config.desktopSessionToken = sessionToken;

  let harbor: HarborApp | undefined;
  try {
    harbor = await buildApp(config);
    await harbor.app.listen({ host: target.host, port: target.port });
  } catch (error) {
    await harbor?.app.close().catch(() => undefined);
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    const detail =
      code === "EADDRINUSE"
        ? `Loopback port ${target.port} is already in use.`
        : code === "EACCES"
          ? `Access to loopback port ${target.port} was denied.`
          : `Initialization failed on ${target.origin}.`;
    throw new Error(`The desktop-managed gateway could not start. ${detail}`, {
      cause: error,
    });
  }

  const running = harbor;
  return {
    status: {
      state: "managed",
      url: target.origin,
      message: "The gateway was started automatically by Harbor Desk.",
    },
    sessionToken,
    close: async () => {
      await running.app.close();
    },
  };
}
