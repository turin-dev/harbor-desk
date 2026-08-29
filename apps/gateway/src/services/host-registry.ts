import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import type {
  CapabilityMatrix,
  ContainerCreateInput,
  ContainerSummary,
  DashboardSummary,
  EngineEvent,
  EngineSummary,
  Host,
  HostRegistrationInput,
  ImagePullInput,
  ImageSummary,
  PruneResourceKind,
  PruneSummary,
  NetworkCreateInput,
  NetworkSummary,
  TerminalSession,
  VolumeCreateInput,
  VolumeSummary,
} from "@harbor/contracts";
import type { GatewayConfig } from "@harbor/config";
import {
  DockerEngineClient,
  EngineRequestError,
  type PullProgressFrame,
} from "@harbor/connectors";
import { HttpError } from "../errors.js";
import { EventHub } from "./events.js";
import { isOperationCancelledError } from "./operations.js";
import {
  MemoryEncryptedSecretStore,
  type SecretStore,
} from "./secret-store.js";

interface StoredConnection {
  endpoint: string;
  secretReference?: string;
}

interface HostRecord {
  publicHost: Host;
  connection: StoredConnection;
  client: DockerEngineClient;
  lastError?: string;
}

interface ExecRecord {
  session: TerminalSession;
  execId: string;
  record: HostRecord;
}

export interface HostRegistryOptions {
  config: GatewayConfig;
  events: EventHub;
  secrets?: SecretStore;
}

export class HostRegistry {
  private readonly records = new Map<string, HostRecord>();
  private readonly execs = new Map<string, ExecRecord>();
  private readonly config: GatewayConfig;
  private readonly events: EventHub;
  private readonly secrets: SecretStore;
  private stopping = false;

  constructor(options: HostRegistryOptions) {
    this.config = options.config;
    if (options.config.nodeEnv === "production" && !options.secrets) {
      throw new HttpError(
        503,
        "secret_store_not_configured",
        "Production requires an injected Vault/KMS-backed secret store.",
      );
    }
    this.events = options.events;
    this.secrets =
      options.secrets ??
      new MemoryEncryptedSecretStore(options.config.secretMasterKey);
    if (options.config.devEngineHost) {
      const id = "dev-remote-engine";
      this.validateEndpoint(
        options.config.devEngineHost,
        options.config.devEngineTls,
      );
      const client = this.createClient({
        endpoint: options.config.devEngineHost,
        ca:
          options.config.devEngineTls?.ca ??
          (options.config.devEngineTls?.caFile
            ? readFileSync(options.config.devEngineTls.caFile, "utf8")
            : undefined),
        cert:
          options.config.devEngineTls?.cert ??
          (options.config.devEngineTls?.certFile
            ? readFileSync(options.config.devEngineTls.certFile, "utf8")
            : undefined),
        key:
          options.config.devEngineTls?.key ??
          (options.config.devEngineTls?.keyFile
            ? readFileSync(options.config.devEngineTls.keyFile, "utf8")
            : undefined),
      });
      this.records.set(id, {
        client,
        connection: { endpoint: options.config.devEngineHost },
        publicHost: this.createPublicHost(
          id,
          options.config.devEngineDisplayName ?? "Development remote engine",
          client,
          this.connectionMode(options.config.devEngineHost),
        ),
      });
    }
  }

  public async start(): Promise<void> {
    await Promise.all(
      [...this.records.values()].map((record) => this.refresh(record)),
    );
    for (const [id, record] of this.records) this.watchEvents(id, record);
  }

  public async close(): Promise<void> {
    this.stopping = true;
  }

  public dependencyStatus(): "ok" | "unavailable" | "not-configured" {
    const hosts = this.list();
    if (!hosts.length) return "not-configured";
    return hosts.some((host) => host.status === "online")
      ? "ok"
      : "unavailable";
  }

  public list(): Host[] {
    return [...this.records.values()].map((record) => ({
      ...record.publicHost,
    }));
  }

  public get(hostId: string): HostRecord {
    const record = this.records.get(hostId);
    if (!record)
      throw new HttpError(404, "host_not_found", "Remote host was not found.");
    return record;
  }

  public async add(input: HostRegistrationInput): Promise<Host> {
    this.validateEndpoint(input.endpoint, input);
    const id = randomUUID();
    const secret = JSON.stringify({
      ca: input.ca,
      cert: input.cert,
      key: input.key,
    });
    const hasTlsMaterial = Boolean(input.ca || input.cert || input.key);
    const secretReference = hasTlsMaterial
      ? await this.secrets.put(secret)
      : undefined;
    const client = this.createClient({
      endpoint: input.endpoint,
      ca: input.ca,
      cert: input.cert,
      key: input.key,
    });
    const protocol = new URL(input.endpoint).protocol;
    const connectionMode =
      protocol === "https:"
        ? "mtls"
        : protocol === "npipe:" || protocol === "unix:"
          ? "development-socket"
          : "development-http";
    const record: HostRecord = {
      client,
      connection: { endpoint: input.endpoint, secretReference },
      publicHost: this.createPublicHost(
        id,
        input.displayName,
        client,
        connectionMode,
      ),
    };
    this.records.set(id, record);
    await this.refresh(record);
    this.watchEvents(id, record);
    return { ...record.publicHost };
  }

  public async remove(hostId: string): Promise<void> {
    const record = this.get(hostId);
    this.records.delete(hostId);
    if (record.connection.secretReference)
      await this.secrets.delete(record.connection.secretReference);
  }

  public async test(hostId: string): Promise<Host> {
    const record = this.get(hostId);
    await this.refresh(record);
    return { ...record.publicHost };
  }

  public async dashboard(hostId: string): Promise<DashboardSummary> {
    const record = this.get(hostId);
    try {
      const [rawEngine, containers, volumes, networks] = await Promise.all([
        record.client.getInfo(),
        record.client.listContainers(true, hostId),
        record.client.listVolumes(hostId),
        record.client.listNetworks(hostId),
      ]);
      const engine: EngineSummary = {
        ...rawEngine,
        version: rawEngine.version ?? record.publicHost.engineVersion,
        apiVersion: rawEngine.apiVersion ?? record.publicHost.apiVersion,
        minApiVersion:
          rawEngine.minApiVersion ?? record.publicHost.minApiVersion,
      };
      this.markOnline(record, engine);
      return {
        host: { ...record.publicHost },
        engine,
        counts: {
          containers: containers.length,
          running: containers.filter(
            (container) => container.state === "running",
          ).length,
          images: engine.images ?? 0,
          volumes: volumes.length,
          networks: networks.length,
        },
      };
    } catch (error) {
      this.markOffline(record, error);
      throw this.upstreamError(error);
    }
  }

  public async listContainers(
    hostId: string,
    all = true,
  ): Promise<ContainerSummary[]> {
    const record = this.get(hostId);
    try {
      const data = await record.client.listContainers(all, hostId);
      this.markOnline(record);
      return data;
    } catch (error) {
      this.markOffline(record, error);
      throw this.upstreamError(error);
    }
  }

  public async listImages(hostId: string): Promise<ImageSummary[]> {
    const record = this.get(hostId);
    try {
      const data = await record.client.listImages(hostId);
      this.markOnline(record);
      return data;
    } catch (error) {
      this.markOffline(record, error);
      throw this.upstreamError(error);
    }
  }

  public async inspectImage(
    hostId: string,
    imageId: string,
  ): Promise<Record<string, unknown>> {
    const record = this.get(hostId);
    try {
      const data = await record.client.inspectImage(imageId);
      this.markOnline(record);
      return data;
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async pullImage(
    hostId: string,
    input: ImagePullInput,
    onProgress?: (frame: PullProgressFrame) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const record = this.get(hostId);
    this.assertOnline(record);
    try {
      await record.client.pullImage(input, onProgress, signal);
      this.markOnline(record);
    } catch (error) {
      if (isOperationCancelledError(error)) throw error;
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async pruneResources(
    hostId: string,
    kind: PruneResourceKind,
    all = false,
  ): Promise<PruneSummary> {
    const record = this.get(hostId);
    this.assertOnline(record);
    try {
      const summary =
        kind === "containers"
          ? await record.client.pruneContainers(all)
          : kind === "images"
            ? await record.client.pruneImages(all)
            : kind === "volumes"
              ? await record.client.pruneVolumes()
              : await record.client.pruneNetworks();
      this.markOnline(record);
      return summary;
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async deleteImage(
    hostId: string,
    imageId: string,
    force: boolean,
  ): Promise<void> {
    const record = this.get(hostId);
    this.assertOnline(record);
    try {
      await record.client.deleteImage(imageId, force);
      this.markOnline(record);
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async listVolumes(hostId: string): Promise<VolumeSummary[]> {
    const record = this.get(hostId);
    try {
      const data = await record.client.listVolumes(hostId);
      this.markOnline(record);
      return data;
    } catch (error) {
      this.markOffline(record, error);
      throw this.upstreamError(error);
    }
  }

  public async inspectVolume(
    hostId: string,
    name: string,
  ): Promise<Record<string, unknown>> {
    const record = this.get(hostId);
    try {
      const data = await record.client.inspectVolume(name);
      this.markOnline(record);
      return data;
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async createVolume(
    hostId: string,
    input: VolumeCreateInput,
  ): Promise<void> {
    const record = this.get(hostId);
    this.assertOnline(record);
    try {
      await record.client.createVolume(input);
      this.markOnline(record);
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async deleteVolume(
    hostId: string,
    name: string,
    force: boolean,
  ): Promise<void> {
    const record = this.get(hostId);
    this.assertOnline(record);
    try {
      await record.client.deleteVolume(name, force);
      this.markOnline(record);
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async listNetworks(hostId: string): Promise<NetworkSummary[]> {
    const record = this.get(hostId);
    try {
      const data = await record.client.listNetworks(hostId);
      this.markOnline(record);
      return data;
    } catch (error) {
      this.markOffline(record, error);
      throw this.upstreamError(error);
    }
  }

  public async inspectNetwork(
    hostId: string,
    networkId: string,
  ): Promise<Record<string, unknown>> {
    const record = this.get(hostId);
    try {
      const data = await record.client.inspectNetwork(networkId);
      this.markOnline(record);
      return data;
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async createNetwork(
    hostId: string,
    input: NetworkCreateInput,
  ): Promise<void> {
    const record = this.get(hostId);
    this.assertOnline(record);
    try {
      await record.client.createNetwork(input);
      this.markOnline(record);
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async deleteNetwork(hostId: string, networkId: string): Promise<void> {
    const record = this.get(hostId);
    this.assertOnline(record);
    try {
      await record.client.deleteNetwork(networkId);
      this.markOnline(record);
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async createContainer(
    hostId: string,
    input: ContainerCreateInput,
  ): Promise<string> {
    const record = this.get(hostId);
    this.assertOnline(record);
    try {
      const id = await record.client.createContainer(input);
      this.markOnline(record);
      return id;
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async containerAction(
    hostId: string,
    containerId: string,
    action: "start" | "stop" | "restart" | "pause" | "unpause" | "kill",
  ): Promise<void> {
    const record = this.get(hostId);
    this.assertOnline(record);
    try {
      await record.client.actionContainer(containerId, action);
      this.markOnline(record);
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async deleteContainer(
    hostId: string,
    containerId: string,
    force: boolean,
  ): Promise<void> {
    const record = this.get(hostId);
    this.assertOnline(record);
    try {
      await record.client.deleteContainer(containerId, force);
      this.markOnline(record);
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async inspectContainer(
    hostId: string,
    containerId: string,
  ): Promise<Record<string, unknown>> {
    const record = this.get(hostId);
    try {
      const data = await record.client.inspectContainer(containerId);
      this.markOnline(record);
      return data;
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async containerLogs(
    hostId: string,
    containerId: string,
    tail = "200",
  ): Promise<string> {
    const record = this.get(hostId);
    try {
      const data = await record.client.containerLogs(containerId, tail);
      this.markOnline(record);
      return data;
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async containerStats(
    hostId: string,
    containerId: string,
  ): Promise<Record<string, unknown>> {
    const record = this.get(hostId);
    try {
      const data = await record.client.containerStats(containerId);
      this.markOnline(record);
      return data;
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public async createTerminalSession(
    hostId: string,
    containerId: string,
    command: string,
  ): Promise<TerminalSession> {
    const record = this.get(hostId);
    this.assertOnline(record);
    try {
      const execId = await record.client.createExec(
        containerId,
        ["sh", "-lc", command],
        true,
      );
      const session: TerminalSession = {
        id: randomUUID(),
        hostId,
        containerId,
        createdAt: new Date().toISOString(),
        status: "created",
      };
      this.execs.set(session.id, { session, execId, record });
      return { ...session };
    } catch (error) {
      this.markOfflineIfConnectionError(record, error);
      throw this.upstreamError(error);
    }
  }

  public getTerminalSession(sessionId: string): ExecRecord {
    const session = this.execs.get(sessionId);
    if (!session)
      throw new HttpError(
        404,
        "terminal_session_not_found",
        "Terminal session was not found.",
      );
    return session;
  }

  public async startTerminalSession(sessionId: string) {
    const exec = this.getTerminalSession(sessionId);
    exec.session.status = "running";
    return exec.record.client.startExec(exec.execId, true);
  }

  public async resizeTerminalSession(
    sessionId: string,
    rows: number,
    columns: number,
  ): Promise<void> {
    const exec = this.getTerminalSession(sessionId);
    await exec.record.client.resizeExec(exec.execId, rows, columns);
  }

  public closeTerminalSession(sessionId: string): void {
    const exec = this.execs.get(sessionId);
    if (exec) exec.session.status = "closed";
  }

  private createClient(input: {
    endpoint: string;
    ca?: string;
    cert?: string;
    key?: string;
  }): DockerEngineClient {
    return new DockerEngineClient({
      endpoint: input.endpoint,
      tls:
        input.ca || input.cert || input.key
          ? { ca: input.ca, cert: input.cert, key: input.key }
          : undefined,
    });
  }

  private connectionMode(endpoint: string): Host["connectionMode"] {
    const protocol = new URL(endpoint).protocol;
    if (protocol === "https:") return "mtls";
    if (protocol === "npipe:" || protocol === "unix:")
      return "development-socket";
    return "development-http";
  }

  private createPublicHost(
    id: string,
    displayName: string,
    client: DockerEngineClient,
    connectionMode: Host["connectionMode"],
  ): Host {
    return {
      id,
      displayName,
      status: "unknown",
      capabilities: this.emptyCapabilities(),
      connectionMode,
    };
  }

  private async refresh(record: HostRecord): Promise<void> {
    try {
      const probe = await record.client.probe();
      record.publicHost = {
        ...record.publicHost,
        status: "online",
        engineVersion: probe.summary.version,
        apiVersion: probe.summary.apiVersion,
        minApiVersion: probe.summary.minApiVersion,
        capabilities: probe.capabilities,
        lastSeenAt: new Date().toISOString(),
      };
      record.lastError = undefined;
    } catch (error) {
      this.markOffline(record, error);
    }
  }

  private markOnline(record: HostRecord, summary?: EngineSummary): void {
    record.publicHost = {
      ...record.publicHost,
      status: "online",
      engineVersion: summary?.version ?? record.publicHost.engineVersion,
      apiVersion: summary?.apiVersion ?? record.publicHost.apiVersion,
      minApiVersion: summary?.minApiVersion ?? record.publicHost.minApiVersion,
      lastSeenAt: new Date().toISOString(),
    };
    record.lastError = undefined;
  }

  private markOffline(record: HostRecord, error: unknown): void {
    record.publicHost = { ...record.publicHost, status: "offline" };
    record.lastError =
      error instanceof Error ? error.message : "Connection failed";
  }

  private markOfflineIfConnectionError(
    record: HostRecord,
    error: unknown,
  ): void {
    if (!(error instanceof EngineRequestError) || error.statusCode >= 500)
      this.markOffline(record, error);
  }

  private assertOnline(record: HostRecord): void {
    if (record.publicHost.status !== "online") {
      throw new HttpError(
        409,
        "host_unavailable",
        "Mutations are disabled while the remote host is offline.",
      );
    }
  }

  private upstreamError(error: unknown): HttpError {
    if (error instanceof EngineRequestError) {
      if (error.statusCode === 404)
        return new HttpError(
          404,
          "resource_not_found",
          "The remote resource was not found.",
        );
      if (error.statusCode === 409)
        return new HttpError(
          409,
          "engine_conflict",
          "The remote Engine rejected the operation.",
        );
      if (error.statusCode >= 400 && error.statusCode < 500) {
        return new HttpError(
          error.statusCode,
          "engine_rejected",
          "The remote Engine rejected the operation.",
        );
      }
    }
    return new HttpError(
      502,
      "engine_unavailable",
      "The remote Docker Engine is unavailable.",
      { retryable: true },
    );
  }

  private validateEndpoint(
    endpoint: string,
    tlsMaterial?: {
      ca?: string;
      cert?: string;
      key?: string;
      caFile?: string;
      certFile?: string;
      keyFile?: string;
    },
  ): void {
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new HttpError(
        422,
        "invalid_endpoint",
        "Endpoint must be a valid http or https URL.",
      );
    }
    if (
      !["http:", "https:", "npipe:", "unix:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      throw new HttpError(
        422,
        "invalid_endpoint",
        "Endpoint must use http/https without credentials, or a development socket.",
      );
    }
    if (this.config.nodeEnv === "production") {
      const hasMutualTlsMaterial = Boolean(
        (tlsMaterial?.ca ?? tlsMaterial?.caFile) &&
        (tlsMaterial?.cert ?? tlsMaterial?.certFile) &&
        (tlsMaterial?.key ?? tlsMaterial?.keyFile),
      );
      if (parsed.protocol !== "https:" || !hasMutualTlsMaterial) {
        throw new HttpError(
          422,
          "mtls_required",
          "Production remote hosts must use HTTPS with CA, client certificate, and client key material.",
        );
      }
      const allowlist = this.config.engineEndpointAllowlist;
      if (!allowlist.length) {
        throw new HttpError(
          503,
          "endpoint_policy_not_configured",
          "The production Engine endpoint allowlist is not configured.",
        );
      }
      const hostname = parsed.hostname.toLowerCase();
      const allowed = allowlist.some(
        (entry) =>
          entry === hostname ||
          (entry.startsWith("*.") && hostname.endsWith(entry.slice(1))),
      );
      if (!allowed) {
        throw new HttpError(
          422,
          "endpoint_not_allowed",
          "The remote Engine hostname is not on the gateway allowlist.",
        );
      }
    }
  }

  private emptyCapabilities(): CapabilityMatrix {
    return {
      containers: false,
      images: false,
      volumes: false,
      networks: false,
      logs: false,
      stats: false,
      exec: false,
      compose: false,
      buildkit: false,
      kubernetes: false,
      extensions: false,
      imageScan: false,
      volumeFileBrowser: false,
    };
  }

  private async watchEvents(hostId: string, record: HostRecord): Promise<void> {
    while (!this.stopping && this.records.get(hostId) === record) {
      try {
        const stream = await record.client.createEventStream();
        let buffer = "";
        for await (const chunk of stream) {
          buffer += Buffer.isBuffer(chunk)
            ? chunk.toString("utf8")
            : String(chunk);
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line) as EngineEvent;
              this.markOnline(record);
              this.events.publish({
                hostId,
                type: `engine.${event.action ?? event.status ?? "event"}`,
                resourceKind: String(event.Type ?? "unknown").toLowerCase(),
                resourceId: typeof event.id === "string" ? event.id : undefined,
                payload: event,
                occurredAt: new Date(
                  (event.time ?? Date.now() / 1000) * 1000,
                ).toISOString(),
              });
            } catch {
              // Ignore malformed upstream event lines; the next valid event remains usable.
            }
          }
        }
      } catch (error) {
        if (!this.stopping) this.markOfflineIfConnectionError(record, error);
      }
      if (!this.stopping) await delay(3000);
    }
  }
}
