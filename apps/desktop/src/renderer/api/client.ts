import type {
  ApiErrorResponse,
  ApiResponse,
  AuditEvent,
  AuthProvider,
  ContainerCreateInput,
  ContainerSummary,
  CurrentUser,
  DashboardSummary,
  Host,
  HostRegistrationInput,
  ImagePullInput,
  ImageSummary,
  NetworkCreateInput,
  NetworkSummary,
  Operation,
  PruneResourceKind,
  PruneSummary,
  TerminalSession,
  VolumeCreateInput,
  VolumeSummary,
} from "@harbor/contracts";

const browserGatewaySeed = (
  (import.meta.env?.VITE_GATEWAY_URL as string | undefined) ?? ""
).replace(/\/$/, "");

function websocketUrl(gatewayUrl: string, path: string): string {
  return `${gatewayUrl.replace(/^http/i, "ws")}${path}`;
}

export class GatewayClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly retryable: boolean;

  constructor(status: number, error: ApiErrorResponse["error"]) {
    super(error.message);
    this.name = "GatewayClientError";
    this.status = status;
    this.code = error.code;
    this.retryable = error.retryable;
  }
}

const gatewayRequestTimeoutMs = 15_000;

export function gatewayTransportError(error: unknown): GatewayClientError {
  const name = error instanceof Error ? error.name : "";
  const timedOut = name === "TimeoutError";
  const cancelled = name === "AbortError";
  return new GatewayClientError(0, {
    code: timedOut ? "gateway_timeout" : "gateway_unavailable",
    message: timedOut
      ? "The Gateway request timed out. Check the connection and try again."
      : cancelled
        ? "The Gateway request was cancelled."
        : "The Gateway could not be reached. Check the connection and try again.",
    retryable: true,
    requestId: "unknown",
  });
}

export interface DesktopConnectionStatus {
  mode: "unconfigured" | "detecting" | "gateway" | "engine" | "unavailable";
  endpoint?: string;
  gatewayUrl?: string;
  message: string;
  localGateway: boolean;
  engineHostId?: string;
  engineOnline?: boolean;
}

export const desktopConnection = {
  getStatus: async (): Promise<DesktopConnectionStatus> => {
    if (window.harbor?.connection)
      return window.harbor.connection.getStatus().catch(() => ({
        mode: "unavailable",
        message: "The connection runtime status could not be read.",
        localGateway: false,
      }));

    if (!browserGatewaySeed)
      return {
        mode: "unconfigured",
        message: "No Gateway or Docker Engine connection is configured.",
        localGateway: false,
      };
    try {
      const url = new URL(browserGatewaySeed);
      if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new Error();
      return {
        mode: "gateway",
        endpoint: browserGatewaySeed,
        gatewayUrl: browserGatewaySeed,
        message: "Using the configured Harbor Desk Gateway.",
        localGateway: false,
      };
    } catch {
      return {
        mode: "unavailable",
        endpoint: browserGatewaySeed,
        message: "The configured connection URL is invalid.",
        localGateway: false,
      };
    }
  },
};

async function activeGatewayUrl(): Promise<string> {
  const connection = await desktopConnection.getStatus();
  try {
    if (!connection.gatewayUrl) throw new Error();
    const url = new URL(connection.gatewayUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error();
    return connection.gatewayUrl.replace(/\/$/, "");
  } catch {
    throw new GatewayClientError(0, {
      code: "connection_unavailable",
      message:
        connection.message || "No active Harbor Desk Gateway is configured.",
      retryable: true,
      requestId: "unknown",
    });
  }
}

async function fetchWithToken(
  path: string,
  options: RequestInit,
  accessToken: string | undefined,
): Promise<Response> {
  const [gatewayUrl, desktopSessionToken] = await Promise.all([
    activeGatewayUrl(),
    window.harbor?.connection.getSessionToken().catch(() => undefined),
  ]);
  return fetch(`${gatewayUrl}${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(gatewayRequestTimeoutMs),
    headers: {
      accept: "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(desktopSessionToken
        ? { "x-harbor-desktop-token": desktopSessionToken }
        : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  try {
    let accessToken = await window.harbor?.auth
      .getAccessToken()
      .catch(() => undefined);
    let response = await fetchWithToken(path, options, accessToken);
    if (response.status === 401 && window.harbor?.auth.refresh) {
      const refreshed = await window.harbor.auth.refresh().catch(() => false);
      if (refreshed) {
        accessToken = await window.harbor.auth
          .getAccessToken()
          .catch(() => undefined);
        response = await fetchWithToken(path, options, accessToken);
      }
    }
    if (response.status === 401)
      await window.harbor?.auth.logout().catch(() => undefined);

    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as
        ApiErrorResponse | undefined;
      if (body?.error)
        throw new GatewayClientError(response.status, body.error);
      throw new GatewayClientError(response.status, {
        code: "http_error",
        message: `Gateway returned HTTP ${response.status}.`,
        retryable: response.status >= 500,
        requestId: "unknown",
      });
    }

    if (response.status === 204) return undefined as T;
    const body = (await response.json()) as ApiResponse<T>;
    return body.data;
  } catch (error) {
    if (error instanceof GatewayClientError) throw error;
    throw gatewayTransportError(error);
  }
}

export const gateway = {
  getHealth: () =>
    request<{
      status: "ok" | "degraded";
      version: string;
      dependencies: Record<string, string>;
    }>("/health/live"),
  getAuthProviders: () => request<AuthProvider[]>("/api/v1/auth/providers"),
  getCurrentUser: () => request<CurrentUser>("/api/v1/me"),
  getWebSocketTicket: () =>
    request<{ ticket: string }>("/api/v1/auth/ws-ticket", {
      method: "POST",
      body: "{}",
    }),
  getHosts: () => request<Host[]>("/api/v1/hosts"),
  addHost: (input: HostRegistrationInput) =>
    request<Host>("/api/v1/hosts", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "idempotency-key": crypto.randomUUID() },
    }),
  removeHost: (hostId: string) =>
    request<void>(`/api/v1/hosts/${encodeURIComponent(hostId)}`, {
      method: "DELETE",
    }),
  testHost: (hostId: string) =>
    request<Host>(`/api/v1/hosts/${encodeURIComponent(hostId)}/test`, {
      method: "POST",
    }),
  getDashboard: (hostId: string) =>
    request<DashboardSummary>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/dashboard`,
    ),
  getContainers: (hostId: string) =>
    request<ContainerSummary[]>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/containers`,
    ),
  createContainer: (hostId: string, input: ContainerCreateInput) =>
    request<Operation>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/containers`,
      {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "idempotency-key": crypto.randomUUID() },
      },
    ),
  getContainerInspect: (hostId: string, containerId: string) =>
    request<Record<string, unknown>>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/containers/${encodeURIComponent(containerId)}/inspect`,
    ),
  getContainerLogs: (hostId: string, containerId: string, tail = "200") =>
    request<string>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/containers/${encodeURIComponent(containerId)}/logs?tail=${encodeURIComponent(tail)}`,
    ),
  getContainerStats: (hostId: string, containerId: string) =>
    request<Record<string, unknown>>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/containers/${encodeURIComponent(containerId)}/stats`,
    ),
  getImages: (hostId: string) =>
    request<ImageSummary[]>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/images`,
    ),
  pullImage: (hostId: string, input: ImagePullInput, operationId?: string) =>
    request<Operation>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/images/pull`,
      {
        method: "POST",
        body: JSON.stringify(input),
        headers: {
          "idempotency-key": crypto.randomUUID(),
          ...(operationId ? { "operation-id": operationId } : {}),
        },
      },
    ),
  getImageInspect: (hostId: string, imageId: string) =>
    request<Record<string, unknown>>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/images/${encodeURIComponent(imageId)}/inspect`,
    ),
  deleteImage: (hostId: string, imageId: string, force = false) =>
    request<Operation>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/images/${encodeURIComponent(imageId)}?force=${force ? "true" : "false"}`,
      {
        method: "DELETE",
        headers: { "idempotency-key": crypto.randomUUID() },
      },
    ),
  getVolumes: (hostId: string) =>
    request<VolumeSummary[]>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/volumes`,
    ),
  createVolume: (hostId: string, input: VolumeCreateInput) =>
    request<Operation>(`/api/v1/hosts/${encodeURIComponent(hostId)}/volumes`, {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "idempotency-key": crypto.randomUUID() },
    }),
  getVolumeInspect: (hostId: string, volumeName: string) =>
    request<Record<string, unknown>>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/volumes/${encodeURIComponent(volumeName)}/inspect`,
    ),
  deleteVolume: (hostId: string, volumeName: string, force = false) =>
    request<Operation>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/volumes/${encodeURIComponent(volumeName)}?force=${force ? "true" : "false"}`,
      {
        method: "DELETE",
        headers: { "idempotency-key": crypto.randomUUID() },
      },
    ),
  getNetworks: (hostId: string) =>
    request<NetworkSummary[]>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/networks`,
    ),
  createNetwork: (hostId: string, input: NetworkCreateInput) =>
    request<Operation>(`/api/v1/hosts/${encodeURIComponent(hostId)}/networks`, {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "idempotency-key": crypto.randomUUID() },
    }),
  getNetworkInspect: (hostId: string, networkId: string) =>
    request<Record<string, unknown>>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/networks/${encodeURIComponent(networkId)}/inspect`,
    ),
  deleteNetwork: (hostId: string, networkId: string) =>
    request<Operation>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/networks/${encodeURIComponent(networkId)}`,
      {
        method: "DELETE",
        headers: { "idempotency-key": crypto.randomUUID() },
      },
    ),
  containerAction: (hostId: string, containerId: string, action: string) =>
    request<Operation>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/containers/${encodeURIComponent(containerId)}/${action}`,
      { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } },
    ),
  deleteContainer: (hostId: string, containerId: string, force = false) =>
    request<Operation>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/containers/${encodeURIComponent(containerId)}?force=${force ? "true" : "false"}`,
      { method: "DELETE", headers: { "idempotency-key": crypto.randomUUID() } },
    ),
  getOperation: (operationId: string) =>
    request<Operation>(`/api/v1/operations/${encodeURIComponent(operationId)}`),
  cancelOperation: (operationId: string) =>
    request<Operation>(
      `/api/v1/operations/${encodeURIComponent(operationId)}/cancel`,
      { method: "POST" },
    ),
  getAudit: (limit = 200) =>
    request<AuditEvent[]>(`/api/v1/audit?limit=${limit}`),
  pruneResources: (hostId: string, kind: PruneResourceKind, all = false) =>
    request<Operation>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/prune/${kind}?all=${all ? "true" : "false"}`,
      { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } },
    ),
  createTerminalSession: (
    hostId: string,
    containerId: string,
    command: string,
  ) =>
    request<TerminalSession>(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/containers/${encodeURIComponent(containerId)}/exec`,
      { method: "POST", body: JSON.stringify({ command }) },
    ),
};

export async function getGatewayWebSocketUrl(
  hostId?: string,
  cursor?: string,
  ticket?: string,
): Promise<string> {
  const query = new URLSearchParams();
  if (hostId) query.set("hostId", hostId);
  if (cursor) query.set("cursor", cursor);
  if (ticket) query.set("ticket", ticket);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return websocketUrl(await activeGatewayUrl(), `/api/v1/stream${suffix}`);
}

export async function getTerminalWebSocketUrl(
  sessionId: string,
  ticket?: string,
): Promise<string> {
  const query = ticket ? `?ticket=${encodeURIComponent(ticket)}` : "";
  return websocketUrl(
    await activeGatewayUrl(),
    `/api/v1/terminal/${encodeURIComponent(sessionId)}${query}`,
  );
}
