export type Role = "viewer" | "operator" | "admin";

export type HostStatus = "online" | "offline" | "degraded" | "unknown";

export type OperationStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type ContainerState =
  | "created"
  | "restarting"
  | "running"
  | "paused"
  | "exited"
  | "dead"
  | "unknown";

export interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  total?: number;
  hasNext?: boolean;
  nextCursor?: string;
}

export interface ApiProblem {
  code: string;
  message: string;
  retryable: boolean;
  requestId: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  error: ApiProblem;
}

export interface CapabilityMatrix {
  containers: boolean;
  images: boolean;
  volumes: boolean;
  networks: boolean;
  logs: boolean;
  stats: boolean;
  exec: boolean;
  compose: boolean;
  buildkit: boolean;
  kubernetes: boolean;
  extensions: boolean;
  imageScan: boolean;
  volumeFileBrowser: boolean;
}

export interface Host {
  id: string;
  displayName: string;
  status: HostStatus;
  engineVersion?: string;
  apiVersion?: string;
  minApiVersion?: string;
  capabilities: CapabilityMatrix;
  lastSeenAt?: string;
  connectionMode: "mtls" | "development-http" | "development-socket";
}

export interface HostRegistrationInput {
  displayName: string;
  endpoint: string;
  ca?: string;
  cert?: string;
  key?: string;
}

export interface ContainerCreateInput {
  image: string;
  name?: string;
  command?: string;
  ports?: PortMapping[];
  env?: EnvVar[];
  restartPolicy?: "no" | "always" | "on-failure" | "unless-stopped";
  labels?: Record<string, string>;
}

export interface PortMapping {
  containerPort: number;
  hostPort?: number;
  protocol?: "tcp" | "udp";
}

export interface EnvVar {
  name: string;
  value: string;
}

export type PruneResourceKind =
  "containers" | "images" | "volumes" | "networks";

export interface PruneSummary {
  freedBytes?: number;
  containersDeleted?: string[];
  imagesDeleted?: Array<{
    Digest?: string;
    Untagged?: string;
    Deleted?: string;
  }>;
  volumesDeleted?: string[];
  networksDeleted?: string[];
}

export interface ImagePullInput {
  image: string;
}

export class OperationCancelledError extends Error {
  constructor(message = "Operation cancelled.") {
    super(message);
    this.name = "OperationCancelledError";
  }
}

export interface VolumeCreateInput {
  name: string;
  driver?: string;
}

export interface NetworkCreateInput {
  name: string;
  driver?: string;
  internal?: boolean;
}

export interface EngineSummary {
  id?: string;
  version?: string;
  apiVersion?: string;
  minApiVersion?: string;
  operatingSystem?: string;
  architecture?: string;
  containers?: number;
  containersRunning?: number;
  containersStopped?: number;
  images?: number;
  memoryTotalBytes?: number;
}

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  imageId?: string;
  command?: string;
  createdAt?: string;
  state: ContainerState;
  status: string;
  ports: string[];
  labels: Record<string, string>;
  hostId: string;
}

export interface ImageSummary {
  id: string;
  repository: string;
  tag: string;
  digest?: string;
  createdAt?: string;
  sizeBytes?: number;
  hostId: string;
}

export interface VolumeSummary {
  name: string;
  driver: string;
  mountpoint?: string;
  scope?: string;
  createdAt?: string;
  hostId: string;
}

export interface NetworkSummary {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  hostId: string;
}

export interface DashboardSummary {
  host: Host;
  engine: EngineSummary;
  counts: {
    containers: number;
    running: number;
    images: number;
    volumes: number;
    networks: number;
  };
}

export interface Operation {
  id: string;
  hostId?: string;
  kind: string;
  status: OperationStatus;
  progress?: number;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: ApiProblem;
}

export interface TerminalSession {
  id: string;
  hostId: string;
  containerId: string;
  createdAt: string;
  status: "created" | "running" | "closed";
}

export interface AuditEvent {
  id: string;
  actorId: string;
  hostId?: string;
  action: string;
  resourceKind?: string;
  resourceId?: string;
  result: "success" | "failure" | "denied";
  requestId: string;
  occurredAt: string;
}

export type TerminalFrame =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number }
  | { type: "resize"; rows: number; columns: number }
  | { type: "keepalive" }
  | { type: "error"; code: string; message: string };

export interface EventEnvelope {
  cursor: string;
  hostId: string;
  type: string;
  resourceKind: string;
  resourceId?: string;
  payload: unknown;
  occurredAt: string;
}

export interface PermissionSet {
  role: Role;
  hostIds: string[];
  actions: string[];
}

export interface AuthProvider {
  id: string;
  displayName: string;
  issuer: string;
  authorizationEndpoint?: string;
  scopes?: string[];
}

export interface CurrentUser {
  id: string;
  displayName: string;
  email?: string;
  role: Role;
  hostIds?: string[];
}

export interface HealthStatus {
  status: "ok" | "degraded";
  version: string;
  dependencies: Record<string, "ok" | "unavailable" | "not-configured">;
}

export interface EngineEvent {
  type: string;
  action?: string;
  actor?: { id?: string; attributes?: Record<string, string> };
  id?: string;
  time?: number;
  timeNano?: number;
  [key: string]: unknown;
}

export const gatewayPaths = {
  health: "/health/live",
  providers: "/api/v1/auth/providers",
  me: "/api/v1/me",
  permissions: "/api/v1/permissions",
  hosts: "/api/v1/hosts",
  stream: "/api/v1/stream",
} as const;
