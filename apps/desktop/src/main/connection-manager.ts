import {
  isHttpEndpoint,
  probeHarborGateway,
  startLocalEngineGateway,
  type LocalGatewayRuntime,
} from "./managed-gateway.js";

export type ConnectionMode =
  "unconfigured" | "detecting" | "gateway" | "engine" | "unavailable";

export interface ConnectionTargetInput {
  endpoint: string;
  displayName?: string;
  ca?: string;
  cert?: string;
  key?: string;
}

export interface StoredConnectionTarget {
  endpoint: string;
  displayName: string;
  ca?: string;
  cert?: string;
  key?: string;
  detectedMode?: "gateway" | "engine";
}

export interface ConnectionStatus {
  mode: ConnectionMode;
  endpoint?: string;
  gatewayUrl?: string;
  message: string;
  localGateway: boolean;
  engineHostId?: string;
  engineOnline?: boolean;
}

export class ConnectionManagerError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConnectionManagerError";
    this.code = code;
  }
}

export interface ConnectionManagerOptions {
  gatewayVersion: string;
  seedEndpoint?: string;
  initialTarget?: StoredConnectionTarget;
  onChanged?: (status: ConnectionStatus) => void;
  probeGateway?: typeof probeHarborGateway;
  startLocalGateway?: typeof startLocalEngineGateway;
}

const maxEndpointLength = 2_048;
const maxCertificateLength = 200_000;

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function normalizeTarget(input: ConnectionTargetInput): StoredConnectionTarget {
  const endpoint = input.endpoint.trim().replace(/\/$/, "");
  if (!endpoint || endpoint.length > maxEndpointLength)
    throw new ConnectionManagerError(
      "invalid_endpoint",
      "Enter a connection URL of at most 2048 characters.",
    );

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new ConnectionManagerError(
      "invalid_endpoint",
      "The connection URL is not valid.",
    );
  }
  if (
    !["http:", "https:", "npipe:", "unix:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    ((parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.pathname !== "/")
  )
    throw new ConnectionManagerError(
      "invalid_endpoint",
      "Use an HTTP(S) root URL or a npipe/unix Docker Engine endpoint without credentials.",
    );

  const certificates = {
    ca: trimOptional(input.ca),
    cert: trimOptional(input.cert),
    key: trimOptional(input.key),
  };
  if (
    Object.values(certificates).some(
      (value) => value !== undefined && value.length > maxCertificateLength,
    )
  )
    throw new ConnectionManagerError(
      "invalid_tls_material",
      "Each certificate field must be at most 200000 characters.",
    );

  return {
    endpoint,
    displayName: trimOptional(input.displayName) ?? "Docker Engine",
    ...certificates,
  };
}

function assertEngineTransport(target: StoredConnectionTarget): void {
  const parsed = new URL(target.endpoint);
  if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname))
    throw new ConnectionManagerError(
      "remote_engine_tls_required",
      "Remote Docker Engines must use HTTPS. Plain HTTP is allowed only for a local Engine.",
    );

  if (
    parsed.protocol === "https:" &&
    !isLoopbackHostname(parsed.hostname) &&
    !(target.ca && target.cert && target.key)
  )
    throw new ConnectionManagerError(
      "remote_engine_tls_required",
      "Remote HTTPS Docker Engines require a CA certificate, client certificate, and private key.",
    );
}

function publicTarget(target: StoredConnectionTarget): StoredConnectionTarget {
  return {
    endpoint: target.endpoint,
    displayName: target.displayName,
    ...(target.detectedMode ? { detectedMode: target.detectedMode } : {}),
    ...(target.detectedMode === "engine"
      ? {
          ...(target.ca ? { ca: target.ca } : {}),
          ...(target.cert ? { cert: target.cert } : {}),
          ...(target.key ? { key: target.key } : {}),
        }
      : {}),
  };
}

export function parseStoredConnectionTarget(
  value: string | undefined,
): StoredConnectionTarget | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<StoredConnectionTarget>;
    if (typeof parsed.endpoint !== "string") return undefined;
    const normalized = normalizeTarget({
      endpoint: parsed.endpoint,
      displayName:
        typeof parsed.displayName === "string" ? parsed.displayName : undefined,
      ca: typeof parsed.ca === "string" ? parsed.ca : undefined,
      cert: typeof parsed.cert === "string" ? parsed.cert : undefined,
      key: typeof parsed.key === "string" ? parsed.key : undefined,
    });
    return publicTarget({
      ...normalized,
      detectedMode:
        parsed.detectedMode === "gateway" || parsed.detectedMode === "engine"
          ? parsed.detectedMode
          : undefined,
    });
  } catch {
    return undefined;
  }
}

export class ConnectionManager {
  private readonly gatewayVersion: string;
  private readonly seedEndpoint?: string;
  private readonly onChanged?: (status: ConnectionStatus) => void;
  private readonly probeGateway: typeof probeHarborGateway;
  private readonly startLocalGateway: typeof startLocalEngineGateway;
  private target?: StoredConnectionTarget;
  private localGateway?: LocalGatewayRuntime;
  private status: ConnectionStatus = {
    mode: "unconfigured",
    message: "No Gateway or Docker Engine connection is configured.",
    localGateway: false,
  };

  constructor(options: ConnectionManagerOptions) {
    this.gatewayVersion = options.gatewayVersion;
    this.seedEndpoint = options.seedEndpoint?.trim() || undefined;
    this.target = options.initialTarget;
    this.onChanged = options.onChanged;
    this.probeGateway = options.probeGateway ?? probeHarborGateway;
    this.startLocalGateway =
      options.startLocalGateway ?? startLocalEngineGateway;
  }

  public getStatus(): ConnectionStatus {
    return { ...this.status };
  }

  public getGatewayUrl(): string | undefined {
    return this.status.gatewayUrl;
  }

  public getSessionToken(): string | undefined {
    return this.localGateway?.sessionToken;
  }

  public getPersistedTarget(): StoredConnectionTarget | undefined {
    return this.target ? publicTarget(this.target) : undefined;
  }

  public async initialize(): Promise<ConnectionStatus> {
    const target =
      this.target ??
      (this.seedEndpoint
        ? normalizeTarget({ endpoint: this.seedEndpoint })
        : undefined);
    if (!target) return this.getStatus();

    if (target.detectedMode === "gateway") {
      this.target = target;
      if (await this.probeGateway(target.endpoint))
        return this.activateExternalGateway(target);
      return this.setUnavailable(
        target,
        "The configured Gateway could not be reached.",
      );
    }

    if (target.detectedMode === "engine") return this.activateEngine(target);

    return this.detectAndActivate(target);
  }

  public async configure(
    input: ConnectionTargetInput,
  ): Promise<ConnectionStatus> {
    const target = normalizeTarget(input);
    await this.stopLocalGateway();
    this.target = undefined;
    this.setStatus({
      mode: "detecting",
      endpoint: target.endpoint,
      message: "Detecting Harbor Desk Gateway or Docker Engine…",
      localGateway: false,
    });
    return this.detectAndActivate(target);
  }

  public async clear(): Promise<ConnectionStatus> {
    await this.stopLocalGateway();
    this.target = undefined;
    return this.setStatus({
      mode: "unconfigured",
      message: "No Gateway or Docker Engine connection is configured.",
      localGateway: false,
    });
  }

  public async close(): Promise<void> {
    await this.stopLocalGateway();
  }

  private async detectAndActivate(
    target: StoredConnectionTarget,
  ): Promise<ConnectionStatus> {
    if (
      isHttpEndpoint(target.endpoint) &&
      (await this.probeGateway(target.endpoint))
    )
      return this.activateExternalGateway(target);

    try {
      assertEngineTransport(target);
      return await this.activateEngine(target);
    } catch (error) {
      const status = this.setUnavailable(
        target,
        error instanceof ConnectionManagerError
          ? error.message
          : "The connection target could not be identified.",
      );
      return status;
    }
  }

  private activateExternalGateway(
    target: StoredConnectionTarget,
  ): ConnectionStatus {
    this.target = publicTarget({ ...target, detectedMode: "gateway" });
    return this.setStatus({
      mode: "gateway",
      endpoint: target.endpoint,
      gatewayUrl: target.endpoint,
      message: "Connected to a Harbor Desk Gateway.",
      localGateway: false,
    });
  }

  private async activateEngine(
    target: StoredConnectionTarget,
  ): Promise<ConnectionStatus> {
    try {
      assertEngineTransport(target);
      const local = await this.startLocalGateway({
        engine: {
          endpoint: target.endpoint,
          displayName: target.displayName ?? "Docker Engine",
          ca: target.ca,
          cert: target.cert,
          key: target.key,
        },
        gatewayVersion: this.gatewayVersion,
      });
      if (!local.engineOnline) {
        await local.close();
        throw new ConnectionManagerError(
          "engine_unavailable",
          "The connection target did not respond as a Docker Engine.",
        );
      }
      this.localGateway = local;
      this.target = publicTarget({ ...target, detectedMode: "engine" });
      return this.setStatus({
        mode: "engine",
        endpoint: target.endpoint,
        gatewayUrl: local.url,
        message: local.engineOnline
          ? "A local Gateway wrapper is managing the Docker Engine."
          : "The local Gateway wrapper is running, but the Docker Engine is offline.",
        localGateway: true,
        engineHostId: local.engineHostId,
        engineOnline: local.engineOnline,
      });
    } catch (error) {
      const status = this.setUnavailable(
        target,
        "The Docker Engine could not be reached through the local Gateway wrapper.",
      );
      return status;
    }
  }

  private setUnavailable(
    target: StoredConnectionTarget,
    message: string,
  ): ConnectionStatus {
    this.target = publicTarget(target);
    return this.setStatus({
      mode: "unavailable",
      endpoint: target.endpoint,
      message,
      localGateway: Boolean(this.localGateway),
      ...(this.localGateway
        ? {
            gatewayUrl: this.localGateway.url,
            engineHostId: this.localGateway.engineHostId,
            engineOnline: this.localGateway.engineOnline,
          }
        : {}),
    });
  }

  private setStatus(status: ConnectionStatus): ConnectionStatus {
    this.status = { ...status };
    this.onChanged?.(this.getStatus());
    return this.getStatus();
  }

  private async stopLocalGateway(): Promise<void> {
    const local = this.localGateway;
    this.localGateway = undefined;
    if (local) await local.close();
  }
}
