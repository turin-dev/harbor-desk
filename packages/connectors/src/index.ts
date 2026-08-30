import { createHash } from "node:crypto";
import {
  request as httpRequest,
  type IncomingMessage,
  type RequestOptions as HttpRequestOptions,
} from "node:http";
import {
  request as httpsRequest,
  type RequestOptions as HttpsRequestOptions,
} from "node:https";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import type {
  CapabilityMatrix,
  ContainerCreateInput,
  ContainerSummary,
  EngineEvent,
  EngineSummary,
  ImagePullInput,
  ImageSummary,
  PruneSummary,
  NetworkSummary,
  NetworkCreateInput,
  VolumeCreateInput,
  VolumeSummary,
} from "@harbor/contracts";
import { HttpError } from "./http-error.js";

export interface EngineTlsMaterial {
  ca?: string;
  cert?: string;
  key?: string;
}

export interface EngineClientOptions {
  endpoint: string;
  tls?: EngineTlsMaterial;
  timeoutMs?: number;
}

export interface EngineProbe {
  summary: EngineSummary;
  capabilities: CapabilityMatrix;
}

export interface PullProgressFrame {
  status?: string;
  id?: string;
  progress?: string;
  detail?: string;
}

export interface BuildProgressFrame {
  stream?: "stdout" | "stderr";
  status?: string;
  id?: string;
  progress?: string;
  progressDetail?: { current?: number; total?: number };
  error?: string;
}

export interface BuildInput {
  tag: string;
  contextTar: Buffer;
  dockerfile?: string;
  buildArgs?: Record<string, string>;
}

interface RawContainer {
  Id: string;
  Names?: string[];
  Image?: string;
  ImageID?: string;
  Command?: string;
  Created?: number;
  State?: string;
  Status?: string;
  Ports?: Array<{
    IP?: string;
    PrivatePort?: number;
    PublicPort?: number;
    Type?: string;
  }>;
  Labels?: Record<string, string>;
}

interface RawImage {
  Id: string;
  RepoTags?: string[];
  RepoDigests?: string[];
  Created?: number;
  Size?: number;
}

interface RawVolume {
  Name: string;
  Driver?: string;
  Mountpoint?: string;
  Scope?: string;
  CreatedAt?: string;
}

interface RawNetwork {
  Id: string;
  Name: string;
  Driver?: string;
  Scope?: string;
  Internal?: boolean;
}

interface RawVersion {
  Version?: string;
  ApiVersion?: string;
  MinAPIVersion?: string;
}

interface RawInfo {
  ID?: string;
  ServerVersion?: string;
  ApiVersion?: string;
  MinAPIVersion?: string;
  OperatingSystem?: string;
  Architecture?: string;
  Containers?: number;
  ContainersRunning?: number;
  ContainersStopped?: number;
  Images?: number;
  MemTotal?: number;
  Driver?: string;
  NCPU?: number;
}

interface RawExecCreateResponse {
  Id?: string;
}

interface RawCreateResponse {
  Id?: string;
  Name?: string;
  Warnings?: string[];
}

type EngineRequestOptions = HttpRequestOptions &
  Pick<HttpsRequestOptions, "ca" | "cert" | "key" | "rejectUnauthorized">;

export class EngineRequestError extends Error {
  public readonly statusCode: number;
  public readonly responseBody: string;

  constructor(message: string, statusCode: number, responseBody: string) {
    super(message);
    this.name = "EngineRequestError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export { HttpError };

function parseApiVersion(value: string | undefined): number {
  const parsed = Number.parseFloat(value?.replace(/^v/i, "") ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function toContainerState(
  value: string | undefined,
): ContainerSummary["state"] {
  switch (value) {
    case "created":
    case "restarting":
    case "running":
    case "paused":
    case "exited":
    case "dead":
      return value;
    default:
      return "unknown";
  }
}

function formatPorts(ports: RawContainer["Ports"]): string[] {
  return [
    ...new Set(
      (ports ?? []).map((port) => {
        const publicPort = port.PublicPort ? `${port.PublicPort}:` : "";
        return `${publicPort}${port.PrivatePort ?? "?"}${port.Type ? `/${port.Type}` : ""}`;
      }),
    ),
  ];
}

function toDate(seconds: number | undefined): string | undefined {
  return typeof seconds === "number"
    ? new Date(seconds * 1000).toISOString()
    : undefined;
}

function digestForEvent(event: EngineEvent): string {
  return createHash("sha256")
    .update(JSON.stringify(event))
    .digest("hex")
    .slice(0, 20);
}

export function consumeBuildFrame(
  line: string,
  onProgress?: (frame: BuildProgressFrame) => void,
): void {
  if (!line.trim()) return;
  try {
    const frame = JSON.parse(line) as BuildProgressFrame;
    if (typeof frame.error === "string" && frame.error)
      throw new EngineRequestError(frame.error, 500, line);
    onProgress?.(frame);
  } catch (error) {
    if (error instanceof EngineRequestError) throw error;
    onProgress?.({ stream: "stdout", status: line });
  }
}

function consumePullFrame(
  line: string,
  onProgress?: (frame: PullProgressFrame) => void,
): void {
  if (!line.trim()) return;
  try {
    const frame = JSON.parse(line) as PullProgressFrame & { error?: unknown };
    if (typeof frame.error === "string" && frame.error)
      throw new EngineRequestError(frame.error, 500, line);
    onProgress?.(frame);
  } catch (error) {
    if (error instanceof EngineRequestError) throw error;
    // Docker may emit a non-JSON progress line; HTTP status remains the
    // source of truth for a completed pull.
  }
}

export class DockerEngineClient {
  private readonly endpoint: URL;
  private readonly endpointText: string;
  private readonly tls?: EngineTlsMaterial;
  private readonly timeoutMs: number;
  private apiVersion = "";

  constructor(options: EngineClientOptions) {
    this.endpointText = options.endpoint;
    this.endpoint = new URL(options.endpoint);
    if (
      !["http:", "https:", "npipe:", "unix:"].includes(this.endpoint.protocol)
    ) {
      throw new Error(
        "Docker Engine endpoint must use http, https, npipe, or unix",
      );
    }
    this.tls = options.tls;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  public async probe(): Promise<EngineProbe> {
    const [version, info] = await Promise.all([
      this.requestJson<RawVersion>("/version"),
      this.requestJson<RawInfo>("/info"),
    ]);

    this.apiVersion = version.ApiVersion ?? info.ApiVersion ?? "";
    const apiVersion = version.ApiVersion ?? info.ApiVersion;
    const minApiVersion = version.MinAPIVersion ?? info.MinAPIVersion;

    return {
      summary: {
        id: info.ID,
        version: version.Version ?? info.ServerVersion,
        apiVersion,
        minApiVersion,
        operatingSystem: info.OperatingSystem,
        architecture: info.Architecture,
        containers: info.Containers,
        containersRunning: info.ContainersRunning,
        containersStopped: info.ContainersStopped,
        images: info.Images,
        memoryTotalBytes: info.MemTotal,
      },
      capabilities: {
        containers: true,
        images: true,
        volumes: true,
        networks: true,
        logs: true,
        stats: true,
        exec: true,
        compose: false,
        buildkit: parseApiVersion(apiVersion) >= 1.39,
        kubernetes: false,
        extensions: false,
        imageScan: true,
        volumeFileBrowser: false,
      },
    };
  }

  public async getInfo(): Promise<EngineSummary> {
    const info = await this.requestJson<RawInfo>("/info");
    return {
      id: info.ID,
      version: info.ServerVersion,
      apiVersion: info.ApiVersion,
      minApiVersion: info.MinAPIVersion,
      operatingSystem: info.OperatingSystem,
      architecture: info.Architecture,
      containers: info.Containers,
      containersRunning: info.ContainersRunning,
      containersStopped: info.ContainersStopped,
      images: info.Images,
      memoryTotalBytes: info.MemTotal,
    };
  }

  public async listContainers(
    all = true,
    hostId = "",
  ): Promise<ContainerSummary[]> {
    const query = new URLSearchParams({ all: all ? "1" : "0" });
    const rows = await this.requestJson<RawContainer[]>(
      `/containers/json?${query.toString()}`,
    );
    return rows.map((row) => ({
      id: row.Id,
      name: row.Names?.[0]?.replace(/^\//, "") ?? row.Id.slice(0, 12),
      image: row.Image ?? "",
      imageId: row.ImageID,
      command: row.Command,
      createdAt: toDate(row.Created),
      state: toContainerState(row.State),
      status: row.Status ?? row.State ?? "unknown",
      ports: formatPorts(row.Ports),
      labels: row.Labels ?? {},
      hostId,
    }));
  }

  public async listImages(hostId = ""): Promise<ImageSummary[]> {
    const rows = await this.requestJson<RawImage[]>("/images/json?all=1");
    return rows.flatMap((row) => {
      const tags = row.RepoTags?.length ? row.RepoTags : ["<none>:<none>"];
      return tags.map((tag) => {
        const separator = tag.lastIndexOf(":");
        return {
          id: row.Id,
          repository: separator > 0 ? tag.slice(0, separator) : tag,
          tag: separator > 0 ? tag.slice(separator + 1) : "<none>",
          digest: row.RepoDigests?.[0],
          createdAt: toDate(row.Created),
          sizeBytes: row.Size,
          hostId,
        };
      });
    });
  }

  public async inspectImage(imageId: string): Promise<Record<string, unknown>> {
    return this.requestJson<Record<string, unknown>>(
      `/images/${encodeURIComponent(imageId)}/json`,
    );
  }

  public async pullImage(
    input: ImagePullInput,
    onProgress?: (frame: PullProgressFrame) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw this.abortError();
    const response = await this.requestStream(
      `/images/create?fromImage=${encodeURIComponent(input.image)}`,
      { method: "POST", ...(signal ? { signal } : {}) },
    );
    let buffer = "";
    const consume = async () => {
      for await (const chunk of response) {
        buffer += Buffer.isBuffer(chunk)
          ? chunk.toString("utf8")
          : String(chunk);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) consumePullFrame(line, onProgress);
      }
      consumePullFrame(buffer, onProgress);
    };
    if (!signal) {
      await consume();
      return;
    }
    let rejectRace: (error: Error) => void = () => undefined;
    const onAbort = () => rejectRace(this.abortError());
    try {
      await Promise.race([
        consume(),
        new Promise<never>((_resolve, reject) => {
          rejectRace = reject;
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  public async buildImage(
    input: BuildInput,
    onProgress?: (frame: BuildProgressFrame) => void,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (signal?.aborted) throw this.abortError();
    const parts: string[] = ["t=" + encodeURIComponent(input.tag)];
    const dockerfile = input.dockerfile?.trim();
    if (dockerfile) parts.push("dockerfile=" + encodeURIComponent(dockerfile));
    for (const [key, value] of Object.entries(input.buildArgs ?? {})) {
      const valueText = value?.trim() ?? "";
      if (!valueText) continue;
      parts.push("buildArg=" + encodeURIComponent(key + "=" + valueText));
    }
    const query = "/build?" + parts.join("&");
    const response = await this.requestStream(query, {
      method: "POST",
      body: input.contextTar,
      headers: { "content-type": "application/tar" },
      ...(signal ? { signal } : {}),
    });
    let buffer = "";
    let imageId: string | undefined;
    const consume = async () => {
      for await (const chunk of response) {
        buffer += Buffer.isBuffer(chunk)
          ? chunk.toString("utf8")
          : String(chunk);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          consumeBuildFrame(line, onProgress);
          if (line.includes('"Aux"')) {
            try {
              const aux = JSON.parse(line) as {
                stream?: unknown;
                Aux?: { ID?: string };
              };
              if (aux.stream === "aux" && aux.Aux?.ID) imageId = aux.Aux.ID;
            } catch {
              // aux frames are best-effort metadata
            }
          }
        }
      }
      consumeBuildFrame(buffer, onProgress);
    };
    if (!signal) {
      await consume();
      return imageId;
    }
    let rejectRace: (error: Error) => void = () => undefined;
    const onAbort = () => rejectRace(this.abortError());
    try {
      await Promise.race([
        consume(),
        new Promise<never>((_resolve, reject) => {
          rejectRace = reject;
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    return imageId;
  }

  public async pruneContainers(
    all: boolean,
    signal?: AbortSignal,
  ): Promise<PruneSummary> {
    const response = await this.requestJson<{
      ContainersDeleted?: string[];
      SpaceReclaimed?: number;
    }>(`/containers/prune?all=${all ? "1" : "0"}`, {
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    return {
      freedBytes: response.SpaceReclaimed,
      containersDeleted: response.ContainersDeleted,
    };
  }

  public async pruneImages(
    all: boolean,
    signal?: AbortSignal,
  ): Promise<PruneSummary> {
    const response = await this.requestJson<{
      ImagesDeleted?: Array<{
        Digest?: string;
        Untagged?: string;
        Deleted?: string;
      }>;
      SpaceReclaimed?: number;
    }>(`/images/prune?all=${all ? "1" : "0"}`, {
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    return {
      freedBytes: response.SpaceReclaimed,
      imagesDeleted: response.ImagesDeleted,
    };
  }

  public async pruneVolumes(signal?: AbortSignal): Promise<PruneSummary> {
    const response = await this.requestJson<{
      VolumesDeleted?: string[];
    }>("/volumes/prune", {
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    return { volumesDeleted: response.VolumesDeleted };
  }

  public async pruneNetworks(signal?: AbortSignal): Promise<PruneSummary> {
    const response = await this.requestJson<{
      NetworksDeleted?: string[];
    }>("/networks/prune", {
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    return { networksDeleted: response.NetworksDeleted };
  }

  public async deleteImage(
    imageId: string,
    force = false,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.requestJson(
      `/images/${encodeURIComponent(imageId)}?force=${force ? "1" : "0"}`,
      {
        method: "DELETE",
        ...(signal ? { signal } : {}),
      },
    );
  }

  public async listVolumes(hostId = ""): Promise<VolumeSummary[]> {
    const response = await this.requestJson<{ Volumes?: RawVolume[] }>(
      "/volumes",
    );
    return (response.Volumes ?? []).map((row) => ({
      name: row.Name,
      driver: row.Driver ?? "unknown",
      mountpoint: row.Mountpoint,
      scope: row.Scope,
      createdAt: row.CreatedAt,
      hostId,
    }));
  }

  public async inspectVolume(name: string): Promise<Record<string, unknown>> {
    return this.requestJson<Record<string, unknown>>(
      `/volumes/${encodeURIComponent(name)}`,
    );
  }

  public async createVolume(
    input: VolumeCreateInput,
    signal?: AbortSignal,
  ): Promise<VolumeSummary> {
    const response = await this.requestJson<RawCreateResponse>(
      "/volumes/create",
      {
        method: "POST",
        body: { Name: input.name, Driver: input.driver || "local" },
        ...(signal ? { signal } : {}),
      },
    );
    return {
      name: response.Name ?? input.name,
      driver: input.driver || "local",
      hostId: "",
    };
  }

  public async deleteVolume(
    name: string,
    force = false,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.requestJson(
      `/volumes/${encodeURIComponent(name)}?force=${force ? "1" : "0"}`,
      {
        method: "DELETE",
        ...(signal ? { signal } : {}),
      },
    );
  }

  public async listNetworks(hostId = ""): Promise<NetworkSummary[]> {
    const rows = await this.requestJson<RawNetwork[]>("/networks");
    return rows.map((row) => ({
      id: row.Id,
      name: row.Name,
      driver: row.Driver ?? "unknown",
      scope: row.Scope ?? "local",
      internal: row.Internal ?? false,
      hostId,
    }));
  }

  public async inspectNetwork(
    networkId: string,
  ): Promise<Record<string, unknown>> {
    return this.requestJson<Record<string, unknown>>(
      `/networks/${encodeURIComponent(networkId)}`,
    );
  }

  public async createNetwork(
    input: NetworkCreateInput,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.requestJson<RawCreateResponse>(
      "/networks/create",
      {
        method: "POST",
        body: {
          Name: input.name,
          Driver: input.driver || "bridge",
          Internal: input.internal ?? false,
        },
        ...(signal ? { signal } : {}),
      },
    );
    if (!response.Id)
      throw new Error("Docker Engine did not return a network id.");
    return response.Id;
  }

  public async deleteNetwork(
    networkId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.requestJson(`/networks/${encodeURIComponent(networkId)}`, {
      method: "DELETE",
      ...(signal ? { signal } : {}),
    });
  }

  public async createContainer(
    input: ContainerCreateInput,
    signal?: AbortSignal,
  ): Promise<string> {
    const query = input.name ? `?name=${encodeURIComponent(input.name)}` : "";
    const body: Record<string, unknown> = { Image: input.image };
    if (input.command?.trim()) body.Cmd = ["sh", "-lc", input.command.trim()];
    if (input.restartPolicy) body.RestartPolicy = { Name: input.restartPolicy };
    if (input.labels && Object.keys(input.labels).length)
      body.Labels = input.labels;
    if (input.env?.length)
      body.Env = input.env.map((item) => `${item.name}=${item.value}`);
    if (input.ports?.length) {
      const exposedPorts: Record<string, Record<string, never>> = {};
      const portBindings: Record<string, Array<Record<string, string>>> = {};
      for (const mapping of input.ports) {
        const key = `${mapping.containerPort}/${mapping.protocol ?? "tcp"}`;
        exposedPorts[key] = {};
        portBindings[key] = [
          mapping.hostPort ? { HostPort: String(mapping.hostPort) } : {},
        ];
      }
      body.ExposedPorts = exposedPorts;
      body.PortBindings = portBindings;
    }
    const response = await this.requestJson<RawCreateResponse>(
      `/containers/create${query}`,
      { method: "POST", body, ...(signal ? { signal } : {}) },
    );
    if (!response.Id)
      throw new Error("Docker Engine did not return a container id.");
    return response.Id;
  }

  public async actionContainer(
    containerId: string,
    action: "start" | "stop" | "restart" | "pause" | "unpause" | "kill",
    signal?: AbortSignal,
  ): Promise<void> {
    await this.requestJson(
      `/containers/${encodeURIComponent(containerId)}/${action}`,
      {
        method: "POST",
        ...(signal ? { signal } : {}),
      },
    );
  }

  public async deleteContainer(
    containerId: string,
    force = false,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.requestJson(
      `/containers/${encodeURIComponent(containerId)}?force=${force ? "1" : "0"}`,
      {
        method: "DELETE",
        ...(signal ? { signal } : {}),
      },
    );
  }

  public async inspectContainer(
    containerId: string,
  ): Promise<Record<string, unknown>> {
    return this.requestJson<Record<string, unknown>>(
      `/containers/${encodeURIComponent(containerId)}/json`,
    );
  }

  public async containerLogs(
    containerId: string,
    tail = "200",
  ): Promise<string> {
    const query = new URLSearchParams({
      stdout: "1",
      stderr: "1",
      timestamps: "1",
      tail,
    });
    const response = await this.requestStream(
      `/containers/${encodeURIComponent(containerId)}/logs?${query.toString()}`,
    );
    return decodeDockerStream(await collectBuffer(response));
  }

  public async containerStats(
    containerId: string,
  ): Promise<Record<string, unknown>> {
    return this.requestJson<Record<string, unknown>>(
      `/containers/${encodeURIComponent(containerId)}/stats?stream=false`,
    );
  }

  public async createExec(
    containerId: string,
    command: string[],
    tty = true,
  ): Promise<string> {
    const response = await this.requestJson<RawExecCreateResponse>(
      `/containers/${encodeURIComponent(containerId)}/exec`,
      {
        method: "POST",
        body: {
          AttachStdin: false,
          AttachStdout: true,
          AttachStderr: true,
          Tty: tty,
          Cmd: command,
        },
      },
    );
    if (!response.Id)
      throw new Error("Docker Engine did not return an exec session id.");
    return response.Id;
  }

  public async startExec(execId: string, tty = true): Promise<IncomingMessage> {
    return this.requestStream(`/exec/${encodeURIComponent(execId)}/start`, {
      method: "POST",
      body: { Detach: false, Tty: tty },
    });
  }

  public async resizeExec(
    execId: string,
    height: number,
    width: number,
  ): Promise<void> {
    await this.requestJson(
      `/exec/${encodeURIComponent(execId)}/resize?h=${Math.max(1, Math.floor(height))}&w=${Math.max(1, Math.floor(width))}`,
      {
        method: "POST",
      },
    );
  }

  public async createEventStream(
    signal?: AbortSignal,
  ): Promise<IncomingMessage> {
    const response = await this.requestStream("/events", {
      ...(signal ? { signal } : {}),
    });
    if (signal?.aborted) {
      response.destroy(this.abortError());
      return response;
    }
    const onAbort = () => response.destroy(this.abortError());
    signal?.addEventListener("abort", onAbort, { once: true });
    response.once("close", () => signal?.removeEventListener("abort", onAbort));
    return response;
  }

  public async requestJson<T = unknown>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const response = await this.requestRaw(path, options);
    const body = await collectBody(response, options.signal);
    if (response.statusCode && response.statusCode >= 400) {
      throw new EngineRequestError(
        `Docker Engine returned HTTP ${response.statusCode}`,
        response.statusCode,
        body,
      );
    }
    if (!body) return undefined as T;
    try {
      return JSON.parse(body) as T;
    } catch {
      return body as T;
    }
  }

  public async requestStream(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    } = {},
  ): Promise<IncomingMessage> {
    const response = await this.requestRaw(path, { ...options, stream: true });
    if (response.statusCode && response.statusCode >= 400) {
      const body = await collectBody(response);
      throw new EngineRequestError(
        `Docker Engine returned HTTP ${response.statusCode}`,
        response.statusCode,
        body,
      );
    }
    return response;
  }

  public static async fromFiles(
    endpoint: string,
    files: { caFile?: string; certFile?: string; keyFile?: string },
  ): Promise<DockerEngineClient> {
    const [ca, cert, key] = await Promise.all([
      files.caFile
        ? readFile(files.caFile, "utf8")
        : Promise.resolve(undefined),
      files.certFile
        ? readFile(files.certFile, "utf8")
        : Promise.resolve(undefined),
      files.keyFile
        ? readFile(files.keyFile, "utf8")
        : Promise.resolve(undefined),
    ]);
    return new DockerEngineClient({ endpoint, tls: { ca, cert, key } });
  }

  public static eventCursor(event: EngineEvent): string {
    return `${event.timeNano ?? event.time ?? Date.now()}-${digestForEvent(event)}`;
  }

  private async requestRaw(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      stream?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<IncomingMessage> {
    if (options.signal?.aborted) throw this.abortError();
    const pathWithVersion =
      this.apiVersion &&
      !path.startsWith("/version") &&
      !path.startsWith("/info")
        ? `/v${this.apiVersion.replace(/^v/, "")}${path}`
        : path;
    const socketPath = this.getSocketPath();
    const target = socketPath
      ? undefined
      : new URL(pathWithVersion, this.endpoint);
    const requestOptions: EngineRequestOptions = {
      ...(socketPath
        ? { socketPath }
        : {
            protocol: target?.protocol,
            hostname: target?.hostname,
            port: target?.port || undefined,
            path: `${target?.pathname ?? ""}${target?.search ?? ""}`,
          }),
      ...(socketPath ? { path: pathWithVersion } : {}),
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(options.body !== undefined && !Buffer.isBuffer(options.body)
          ? { "content-type": "application/json" }
          : {}),
        ...options.headers,
      },
      timeout: options.stream ? 0 : this.timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    };

    if (target?.protocol === "https:") {
      requestOptions.ca = this.tls?.ca;
      requestOptions.cert = this.tls?.cert;
      requestOptions.key = this.tls?.key;
      requestOptions.rejectUnauthorized = true;
    }

    const request =
      target?.protocol === "https:"
        ? httpsRequest(requestOptions)
        : httpRequest(requestOptions);

    if (options.body !== undefined) {
      if (Buffer.isBuffer(options.body)) {
        request.write(options.body);
      } else {
        request.write(JSON.stringify(options.body));
      }
    }
    request.end();

    return await new Promise<IncomingMessage>((resolve, reject) => {
      request.once("response", resolve);
      request.once("error", (error: Error) => {
        if (
          options.signal &&
          ((error as NodeJS.ErrnoException).code === "ABORT_ERR" ||
            error.name === "AbortError")
        ) {
          reject(this.abortError());
          return;
        }
        reject(error);
      });
      request.once("timeout", () => {
        request.destroy(
          new Error(
            `Docker Engine request timed out after ${this.timeoutMs}ms`,
          ),
        );
      });
    });
  }

  private abortError(): HttpError {
    return new HttpError("operation_cancelled", "The operation was cancelled.");
  }

  private getSocketPath(): string | undefined {
    if (this.endpoint.protocol === "unix:") return this.endpoint.pathname;
    if (this.endpoint.protocol !== "npipe:") return undefined;

    const normalized = this.endpointText
      .replace(/^npipe:\/\//i, "")
      .replace(/^\/+/, "")
      .replace(/\//g, "\\");
    return normalized.startsWith(".") ? `\\\\${normalized}` : `\\${normalized}`;
  }
}

async function collectBody(
  response: IncomingMessage,
  signal?: AbortSignal,
): Promise<string> {
  return (await collectBuffer(response, signal)).toString("utf8");
}

async function collectBuffer(
  response: IncomingMessage,
  signal?: AbortSignal,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let onAbort: (() => void) | undefined;
  if (signal?.aborted) {
    response.destroy();
    throw new HttpError("operation_cancelled", "The operation was cancelled.");
  }
  if (signal) {
    onAbort = () => {
      response.destroy(
        new HttpError("operation_cancelled", "The operation was cancelled."),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    for await (const chunk of response)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
  return Buffer.concat(chunks);
}

function decodeDockerStream(buffer: Buffer): string {
  if (buffer.length < 8 || (buffer[0] !== 1 && buffer[0] !== 2))
    return buffer.toString("utf8");

  const chunks: Buffer[] = [];
  let offset = 0;
  while (
    offset + 8 <= buffer.length &&
    (buffer[offset] === 1 || buffer[offset] === 2)
  ) {
    const length = buffer.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > buffer.length) return buffer.toString("utf8");
    chunks.push(buffer.subarray(start, end));
    offset = end;
  }
  return (offset === buffer.length ? Buffer.concat(chunks) : buffer).toString(
    "utf8",
  );
}
