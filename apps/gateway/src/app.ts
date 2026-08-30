import { randomUUID } from "node:crypto";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { Type } from "@sinclair/typebox";
import type {
  ApiResponse,
  ContainerCreateInput,
  CurrentUser,
  HostRegistrationInput,
  ImagePullInput,
  NetworkCreateInput,
  PruneResourceKind,
  TerminalFrame,
  HubSearchResult,
  VolumeCreateInput,
} from "@harbor/contracts";
import { loadGatewayConfig, type GatewayConfig } from "@harbor/config";
import { EventHub } from "./services/events.js";
import { AuthService } from "./services/auth.js";
import { HostRegistry } from "./services/host-registry.js";
import { OperationStore } from "./services/operations.js";
import { AuditStore, type AuditInput } from "./services/audit.js";
import type { SecretStore } from "./services/secret-store.js";
import { HttpError, problemFromError } from "./errors.js";

const hostParams = Type.Object({
  hostId: Type.String({ minLength: 1, maxLength: 128 }),
});
const providerParams = Type.Object({
  providerId: Type.String({ minLength: 1, maxLength: 128 }),
});
const streamQuery = Type.Object({
  cursor: Type.Optional(Type.String({ maxLength: 256 })),
  hostId: Type.Optional(Type.String({ maxLength: 128 })),
  ticket: Type.Optional(Type.String({ maxLength: 128 })),
});
const authorizeQuery = Type.Object({
  redirectUri: Type.String({ minLength: 1, maxLength: 256 }),
  state: Type.String({ minLength: 16, maxLength: 512 }),
  nonce: Type.String({ minLength: 16, maxLength: 512 }),
  codeChallenge: Type.String({ minLength: 43, maxLength: 128 }),
});
const tokenBody = Type.Object({
  providerId: Type.String({ minLength: 1, maxLength: 128 }),
  code: Type.Optional(Type.String({ maxLength: 4_096 })),
  redirectUri: Type.String({ minLength: 1, maxLength: 256 }),
  codeVerifier: Type.Optional(Type.String({ maxLength: 256 })),
  nonce: Type.Optional(Type.String({ maxLength: 512 })),
  refreshToken: Type.Optional(Type.String({ maxLength: 16_384 })),
});
const containerParams = Type.Object({
  hostId: Type.String({ minLength: 1, maxLength: 128 }),
  containerId: Type.String({ minLength: 1, maxLength: 256 }),
});
const imageParams = Type.Object({
  hostId: Type.String({ minLength: 1, maxLength: 128 }),
  imageId: Type.String({ minLength: 1, maxLength: 512 }),
});
const volumeParams = Type.Object({
  hostId: Type.String({ minLength: 1, maxLength: 128 }),
  volumeName: Type.String({ minLength: 1, maxLength: 255 }),
});
const networkParams = Type.Object({
  hostId: Type.String({ minLength: 1, maxLength: 128 }),
  networkId: Type.String({ minLength: 1, maxLength: 256 }),
});
const hostRegistrationBody = Type.Object({
  displayName: Type.String({ minLength: 1, maxLength: 120 }),
  endpoint: Type.String({ minLength: 8, maxLength: 2048 }),
  ca: Type.Optional(Type.String({ maxLength: 200_000 })),
  cert: Type.Optional(Type.String({ maxLength: 200_000 })),
  key: Type.Optional(Type.String({ maxLength: 200_000 })),
});
const logsQuery = Type.Object({
  tail: Type.Optional(Type.String({ maxLength: 10 })),
});
const execBody = Type.Object({
  command: Type.String({ minLength: 1, maxLength: 4_096 }),
});
const containerCreateBody = Type.Object({
  image: Type.String({ minLength: 1, maxLength: 512 }),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  command: Type.Optional(Type.String({ maxLength: 4_096 })),
  ports: Type.Optional(
    Type.Array(
      Type.Object({
        containerPort: Type.Integer({ minimum: 1, maximum: 65535 }),
        hostPort: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
        protocol: Type.Optional(
          Type.Union([Type.Literal("tcp"), Type.Literal("udp")]),
        ),
      }),
      { maxItems: 32 },
    ),
  ),
  env: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String({ minLength: 1, maxLength: 255 }),
        value: Type.String({ maxLength: 16_384 }),
      }),
      { maxItems: 64 },
    ),
  ),
  restartPolicy: Type.Optional(
    Type.Union([
      Type.Literal("no"),
      Type.Literal("always"),
      Type.Literal("on-failure"),
      Type.Literal("unless-stopped"),
    ]),
  ),
  labels: Type.Optional(
    Type.Record(
      Type.String({ minLength: 1, maxLength: 255 }),
      Type.String({ maxLength: 16_384 }),
    ),
  ),
});
const imagePullBody = Type.Object({
  image: Type.String({ minLength: 1, maxLength: 512 }),
});
const pruneParams = Type.Object({
  hostId: Type.String({ minLength: 1, maxLength: 128 }),
  kind: Type.Union([
    Type.Literal("containers"),
    Type.Literal("images"),
    Type.Literal("volumes"),
    Type.Literal("networks"),
  ]),
});
const pruneQuery = Type.Object({
  all: Type.Optional(Type.Boolean()),
});
const volumeCreateBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  driver: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});
const networkCreateBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  driver: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  internal: Type.Optional(Type.Boolean()),
});
const forceQuery = Type.Object({ force: Type.Optional(Type.Boolean()) });
const actionParams = Type.Object({
  hostId: Type.String({ minLength: 1, maxLength: 128 }),
  containerId: Type.String({ minLength: 1, maxLength: 256 }),
  action: Type.Union([
    Type.Literal("start"),
    Type.Literal("stop"),
    Type.Literal("restart"),
    Type.Literal("pause"),
    Type.Literal("unpause"),
    Type.Literal("kill"),
  ]),
});
const operationParams = Type.Object({
  operationId: Type.String({ minLength: 1, maxLength: 128 }),
});
const auditQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
});
const hubSearchQuery = Type.Object({
  q: Type.String({ minLength: 1, maxLength: 128 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});
const terminalParams = Type.Object({
  sessionId: Type.String({ minLength: 1, maxLength: 128 }),
});

function sendData<T>(
  reply: FastifyReply,
  data: T,
  statusCode = 200,
  meta?: ApiResponse<T>["meta"],
) {
  return reply.code(statusCode).send({ data, ...(meta ? { meta } : {}) });
}

function redactRequestUrl(url: string): string {
  return url.replace(
    /([?&](?:ticket|state|nonce|codeChallenge)=)[^&]*/gi,
    "$1[redacted]",
  );
}

async function requireUser(
  auth: AuthService,
  request: FastifyRequest,
): Promise<CurrentUser> {
  return auth.requireUser(request);
}

function requireRole(
  auth: AuthService,
  audit: AuditStore,
  user: CurrentUser,
  minimum: "viewer" | "operator" | "admin",
  input: Omit<
    Parameters<AuditStore["record"]>[0],
    "actorId" | "result" | "requestId"
  > & { requestId: string },
): void {
  try {
    auth.assertRole(user, minimum);
  } catch (error) {
    audit.record({ ...input, actorId: user.id, result: "denied" });
    throw error;
  }
}

function requireHostAccess(
  auth: AuthService,
  audit: AuditStore,
  user: CurrentUser,
  hostId: string,
  availableHostIds: string[],
  input: Omit<AuditInput, "actorId" | "hostId" | "result">,
): void {
  if (auth.permissions(user, availableHostIds).hostIds.includes(hostId)) return;
  audit.record({
    ...input,
    actorId: user.id,
    hostId,
    result: "denied",
  });
  throw new HttpError(
    403,
    "host_access_denied",
    "You do not have access to this remote host.",
  );
}

function getIdempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers["idempotency-key"];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 256)
    throw new HttpError(
      400,
      "invalid_idempotency_key",
      "Idempotency-Key must be a non-empty string of at most 256 characters.",
    );
  return value.trim();
}

function getOperationId(request: FastifyRequest): string | undefined {
  const value = request.headers["operation-id"];
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return value.trim().length <= 128 ? value.trim() : undefined;
}

export interface HarborApp {
  app: FastifyInstance;
  registry: HostRegistry;
  events: EventHub;
  operations: OperationStore;
  audit: AuditStore;
}

export interface HarborAppDependencies {
  secrets?: SecretStore;
  hubTransport?: (url: string, init?: RequestInit) => Promise<Response>;
}

export async function buildApp(
  config: GatewayConfig = loadGatewayConfig(),
  dependencies: HarborAppDependencies = {},
): Promise<HarborApp> {
  const app = Fastify({
    logger: {
      serializers: {
        req: (request) => ({
          method: request.method,
          url: redactRequestUrl(request.url),
          host: request.headers.host,
          remoteAddress: request.ip,
        }),
      },
    },
    requestIdHeader: "x-request-id",
  });
  const events = new EventHub();
  const auth = new AuthService(config);
  const registry = new HostRegistry({
    config,
    events,
    secrets: dependencies.secrets,
  });
  const operations = new OperationStore(events);
  const audit = new AuditStore();
  const hubTransport =
    dependencies.hubTransport ?? ((url, init) => fetch(url, init));
  const assertHostAccess = (
    user: CurrentUser,
    hostId: string,
    input: Omit<AuditInput, "actorId" | "hostId" | "result">,
  ) =>
    requireHostAccess(
      auth,
      audit,
      user,
      hostId,
      registry.list().map((host) => host.id),
      input,
    );

  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: config.allowedOrigins,
    credentials: true,
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(websocket);

  app.setErrorHandler((error, request, reply) => {
    const errorWithStatus =
      typeof error === "object" && error !== null && "statusCode" in error
        ? (error as { statusCode?: unknown })
        : undefined;
    const statusCode =
      error instanceof HttpError
        ? error.statusCode
        : typeof errorWithStatus?.statusCode === "number" &&
            errorWithStatus.statusCode < 500
          ? errorWithStatus.statusCode
          : 500;
    if (statusCode >= 500)
      request.log.error({ err: error }, "gateway request failed");
    return reply
      .code(statusCode)
      .send({ error: problemFromError(error, request.id) });
  });

  app.get("/health/live", async (_request, reply) =>
    sendData(reply, {
      status: "ok",
      version: config.gatewayVersion,
      dependencies: {
        gateway: "ok",
        engine: registry.dependencyStatus(),
        oidc: config.oidcProviders.length ? "ok" : "not-configured",
        postgres: config.databaseUrl ? "not-configured" : "not-configured",
        redis: config.redisUrl ? "not-configured" : "not-configured",
      },
    }),
  );

  app.get("/api/v1/auth/providers", async (_request, reply) =>
    sendData(reply, auth.providers()),
  );

  app.get(
    "/api/v1/auth/authorize/:providerId",
    { schema: { params: providerParams, querystring: authorizeQuery } },
    async (request, reply) => {
      const { providerId } = request.params as { providerId: string };
      const query = request.query as {
        redirectUri: string;
        state: string;
        nonce: string;
        codeChallenge: string;
      };
      return reply.redirect(auth.authorizationUrl(providerId, query));
    },
  );

  app.post(
    "/api/v1/auth/token",
    { schema: { body: tokenBody } },
    async (request, reply) => {
      const body = request.body as {
        providerId: string;
        code?: string;
        redirectUri: string;
        codeVerifier?: string;
        nonce?: string;
        refreshToken?: string;
      };
      if (
        !body.refreshToken &&
        (!body.code || !body.codeVerifier || !body.nonce)
      ) {
        throw new HttpError(
          400,
          "invalid_oidc_request",
          "An authorization code and PKCE verifier are required.",
        );
      }
      const token = await auth.exchangeCode({
        providerId: body.providerId,
        code: body.code ?? "",
        redirectUri: body.redirectUri,
        codeVerifier: body.codeVerifier,
        nonce: body.nonce,
        refreshToken: body.refreshToken,
      });
      return sendData(reply, token);
    },
  );

  app.post("/api/v1/auth/ws-ticket", async (request, reply) => {
    const user = await requireUser(auth, request);
    return sendData(reply, { ticket: auth.issueWebSocketTicket(user) }, 201);
  });

  app.get("/api/v1/me", async (request, reply) => {
    const user = await requireUser(auth, request);
    return sendData(reply, user);
  });

  app.get("/api/v1/permissions", async (request, reply) => {
    const user = await requireUser(auth, request);
    return sendData(
      reply,
      auth.permissions(
        user,
        registry.list().map((host) => host.id),
      ),
    );
  });

  app.get(
    "/api/v1/audit",
    { schema: { querystring: auditQuery } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      requireRole(auth, audit, user, "admin", {
        action: "audit.read",
        requestId: request.id,
      });
      const { limit } = request.query as { limit?: number };
      return sendData(reply, audit.list(limit));
    },
  );

  app.get("/api/v1/hosts", async (request, reply) => {
    const user = await requireUser(auth, request);
    const visibleHostIds = auth.permissions(
      user,
      registry.list().map((host) => host.id),
    ).hostIds;
    return sendData(
      reply,
      registry.list().filter((host) => visibleHostIds.includes(host.id)),
    );
  });

  app.post(
    "/api/v1/hosts",
    { schema: { body: hostRegistrationBody } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      requireRole(auth, audit, user, "admin", {
        action: "host.register",
        requestId: request.id,
      });
      let host;
      try {
        host = await registry.add(request.body as HostRegistrationInput);
      } catch (error) {
        audit.record({
          actorId: user.id,
          action: "host.register",
          result: "failure",
          requestId: request.id,
        });
        throw error;
      }
      audit.record({
        actorId: user.id,
        action: "host.register",
        hostId: host.id,
        result: "success",
        requestId: request.id,
      });
      return sendData(reply, host, 201);
    },
  );

  app.delete(
    "/api/v1/hosts/:hostId",
    { schema: { params: hostParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId } = request.params as { hostId: string };
      requireRole(auth, audit, user, "admin", {
        action: "host.remove",
        hostId,
        requestId: request.id,
      });
      try {
        await registry.remove(hostId);
        audit.record({
          actorId: user.id,
          action: "host.remove",
          hostId,
          result: "success",
          requestId: request.id,
        });
        return reply.code(204).send();
      } catch (error) {
        audit.record({
          actorId: user.id,
          action: "host.remove",
          hostId,
          result: "failure",
          requestId: request.id,
        });
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/hosts/:hostId/test",
    { schema: { params: hostParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId } = request.params as { hostId: string };
      requireRole(auth, audit, user, "admin", {
        action: "host.test",
        hostId,
        requestId: request.id,
      });
      try {
        const host = await registry.test(hostId);
        audit.record({
          actorId: user.id,
          action: "host.test",
          hostId,
          result: "success",
          requestId: request.id,
        });
        return sendData(reply, host);
      } catch (error) {
        audit.record({
          actorId: user.id,
          action: "host.test",
          hostId,
          result: "failure",
          requestId: request.id,
        });
        throw error;
      }
    },
  );

  app.get(
    "/api/v1/hosts/:hostId/capabilities",
    { schema: { params: hostParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId } = request.params as { hostId: string };
      assertHostAccess(user, hostId, {
        action: "host.capabilities.read",
        requestId: request.id,
      });
      return sendData(reply, registry.get(hostId).publicHost.capabilities);
    },
  );

  app.get(
    "/api/v1/hosts/:hostId/dashboard",
    { schema: { params: hostParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId } = request.params as { hostId: string };
      assertHostAccess(user, hostId, {
        action: "host.dashboard.read",
        requestId: request.id,
      });
      return sendData(reply, await registry.dashboard(hostId));
    },
  );

  app.get(
    "/api/v1/hosts/:hostId/containers",
    { schema: { params: hostParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId } = request.params as { hostId: string };
      assertHostAccess(user, hostId, {
        action: "container.list",
        requestId: request.id,
      });
      return sendData(reply, await registry.listContainers(hostId));
    },
  );

  app.post(
    "/api/v1/hosts/:hostId/containers",
    { schema: { params: hostParams, body: containerCreateBody } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId } = request.params as { hostId: string };
      assertHostAccess(user, hostId, {
        action: "container.create",
        resourceKind: "container",
        requestId: request.id,
      });
      requireRole(auth, audit, user, "operator", {
        action: "container.create",
        hostId,
        resourceKind: "container",
        requestId: request.id,
      });
      const body = request.body as ContainerCreateInput;
      const input: ContainerCreateInput = {
        image: body.image.trim(),
        ...(body.name?.trim() ? { name: body.name.trim() } : {}),
        ...(body.command?.trim() ? { command: body.command.trim() } : {}),
        ...(body.ports?.length ? { ports: body.ports } : {}),
        ...(body.env?.length ? { env: body.env } : {}),
        ...(body.restartPolicy ? { restartPolicy: body.restartPolicy } : {}),
        ...(body.labels && Object.keys(body.labels).length
          ? { labels: body.labels }
          : {}),
      };
      const operation = await operations.run(
        {
          kind: "container.create",
          hostId,
          idempotencyKey: getIdempotencyKey(request),
          requestId: request.id,
        },
        async (signal) => {
          const containerId = await registry.createContainer(
            hostId,
            input,
            signal,
          );
          await registry.containerAction(hostId, containerId, "start", signal);
        },
      );
      audit.record({
        actorId: user.id,
        action: "container.create",
        hostId,
        resourceKind: "container",
        result: operation.status === "succeeded" ? "success" : "failure",
        requestId: request.id,
      });
      return sendData(reply, operation, 202);
    },
  );

  app.get(
    "/api/v1/hosts/:hostId/containers/:containerId/inspect",
    { schema: { params: containerParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId, containerId } = request.params as {
        hostId: string;
        containerId: string;
      };
      assertHostAccess(user, hostId, {
        action: "container.inspect",
        resourceKind: "container",
        resourceId: containerId,
        requestId: request.id,
      });
      return sendData(
        reply,
        await registry.inspectContainer(hostId, containerId),
      );
    },
  );

  app.get(
    "/api/v1/hosts/:hostId/containers/:containerId/logs",
    { schema: { params: containerParams, querystring: logsQuery } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId, containerId } = request.params as {
        hostId: string;
        containerId: string;
      };
      assertHostAccess(user, hostId, {
        action: "container.logs.read",
        resourceKind: "container",
        resourceId: containerId,
        requestId: request.id,
      });
      const { tail = "200" } = request.query as { tail?: string };
      return sendData(
        reply,
        await registry.containerLogs(hostId, containerId, tail),
      );
    },
  );

  app.get(
    "/api/v1/hosts/:hostId/containers/:containerId/stats",
    { schema: { params: containerParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId, containerId } = request.params as {
        hostId: string;
        containerId: string;
      };
      assertHostAccess(user, hostId, {
        action: "container.stats.read",
        resourceKind: "container",
        resourceId: containerId,
        requestId: request.id,
      });
      return sendData(
        reply,
        await registry.containerStats(hostId, containerId),
      );
    },
  );

  app.post(
    "/api/v1/hosts/:hostId/containers/:containerId/exec",
    { schema: { params: containerParams, body: execBody } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId, containerId } = request.params as {
        hostId: string;
        containerId: string;
      };
      assertHostAccess(user, hostId, {
        action: "container.exec",
        resourceKind: "container",
        resourceId: containerId,
        requestId: request.id,
      });
      requireRole(auth, audit, user, "operator", {
        action: "container.exec",
        hostId,
        resourceKind: "container",
        resourceId: containerId,
        requestId: request.id,
      });
      const { command } = request.body as { command: string };
      let session;
      try {
        session = await registry.createTerminalSession(
          hostId,
          containerId,
          command,
        );
      } catch (error) {
        audit.record({
          actorId: user.id,
          action: "container.exec",
          hostId,
          resourceKind: "container",
          resourceId: containerId,
          result: "failure",
          requestId: request.id,
        });
        throw error;
      }
      audit.record({
        actorId: user.id,
        action: "container.exec",
        hostId,
        resourceKind: "container",
        resourceId: containerId,
        result: "success",
        requestId: request.id,
      });
      return sendData(reply, session, 201);
    },
  );

  app.get(
    "/api/v1/hosts/:hostId/images",
    { schema: { params: hostParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId } = request.params as { hostId: string };
      assertHostAccess(user, hostId, {
        action: "image.list",
        requestId: request.id,
      });
      return sendData(reply, await registry.listImages(hostId));
    },
  );

  app.get(
    "/api/v1/hub/search",
    { schema: { querystring: hubSearchQuery } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const query = request.query as { q: string; limit?: number };
      const q = query.q.trim();
      const limit = Math.min(Math.max(query.limit ?? 25, 1), 50);
      audit.record({
        actorId: user.id,
        action: "hub.search",
        resourceKind: "image",
        resourceId: q,
        result: "success",
        requestId: request.id,
      });
      try {
        const url =
          "https://hub.docker.com/v2/search/repositories/" +
          "?query=" +
          encodeURIComponent(q) +
          "&page_size=" +
          limit;
        const response = await hubTransport(url, {
          headers: {
            accept: "application/json",
            "user-agent": "harbor-desk-gateway",
            connection: "close",
          },
          signal: AbortSignal.timeout(20_000),
        });
        if (response.status === 429) {
          throw new HttpError(
            429,
            "hub_rate_limited",
            "Docker Hub is rate limiting search requests. Wait a moment and try again.",
            { retryable: true },
          );
        }
        if (!response.ok) {
          throw new HttpError(
            502,
            "hub_unavailable",
            "Docker Hub returned an unexpected response to the search request.",
            { retryable: true },
          );
        }
        const body = (await response.json().catch(() => undefined)) as
          | { count?: unknown; results?: Array<Record<string, unknown>> }
          | undefined;
        const results = (body?.results ?? [])
          .filter((item) => typeof item?.repo_name === "string")
          .slice(0, limit)
          .map((item) => ({
            repository: String(item.repo_name),
            description:
              typeof item.short_description === "string" &&
              item.short_description
                ? item.short_description
                : undefined,
            starCount:
              typeof item.star_count === "number" ? item.star_count : 0,
            pullCount:
              typeof item.pull_count === "number" ? item.pull_count : 0,
            isOfficial: item.is_official === true,
          })) satisfies HubSearchResult[];
        return sendData(reply, {
          query: q,
          resultCount:
            typeof body?.count === "number" ? body.count : results.length,
          results,
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(
          502,
          "hub_unavailable",
          "The Docker Hub search API could not be reached.",
          { retryable: true },
        );
      }
    },
  );

  app.post(
    "/api/v1/hosts/:hostId/images/pull",
    { schema: { params: hostParams, body: imagePullBody } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId } = request.params as { hostId: string };
      assertHostAccess(user, hostId, {
        action: "image.pull",
        resourceKind: "image",
        requestId: request.id,
      });
      requireRole(auth, audit, user, "operator", {
        action: "image.pull",
        hostId,
        resourceKind: "image",
        requestId: request.id,
      });
      const body = request.body as ImagePullInput;
      const input = { image: body.image.trim() } satisfies ImagePullInput;
      const operationId =
        typeof request.headers["operation-id"] === "string" &&
        (request.headers["operation-id"] as string).trim().length <= 128
          ? (request.headers["operation-id"] as string).trim()
          : undefined;
      const operation = await operations.run(
        {
          kind: "image.pull",
          hostId,
          ...(operationId ? { operationId } : {}),
          idempotencyKey: getIdempotencyKey(request),
          requestId: request.id,
        },
        async (signal) => {
          let lastStatus = "";
          await registry.pullImage(
            hostId,
            input,
            (frame) => {
              if (!frame.status || frame.status === lastStatus) return;
              lastStatus = frame.status;
              const label = frame.id
                ? `${frame.status} ${frame.id}`
                : frame.status;
              operations.setProgress(
                operationId ?? "",
                frame.status === "Pull complete"
                  ? 95
                  : frame.status === "Download complete"
                    ? 90
                    : frame.status === "Waiting"
                      ? 15
                      : 60,
                label,
              );
            },
            signal,
          );
        },
      );

      audit.record({
        actorId: user.id,
        action: "image.pull",
        hostId,
        resourceKind: "image",
        resourceId: input.image,
        result: operation.status === "succeeded" ? "success" : "failure",
        requestId: request.id,
      });
      return sendData(reply, operation, 202);
    },
  );

  app.get(
    "/api/v1/hosts/:hostId/images/:imageId/inspect",
    { schema: { params: imageParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId, imageId } = request.params as {
        hostId: string;
        imageId: string;
      };
      assertHostAccess(user, hostId, {
        action: "image.inspect",
        resourceKind: "image",
        resourceId: imageId,
        requestId: request.id,
      });
      return sendData(reply, await registry.inspectImage(hostId, imageId));
    },
  );

  app.delete(
    "/api/v1/hosts/:hostId/images/:imageId",
    { schema: { params: imageParams, querystring: forceQuery } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId, imageId } = request.params as {
        hostId: string;
        imageId: string;
      };
      assertHostAccess(user, hostId, {
        action: "image.delete",
        resourceKind: "image",
        resourceId: imageId,
        requestId: request.id,
      });
      requireRole(auth, audit, user, "operator", {
        action: "image.delete",
        hostId,
        resourceKind: "image",
        resourceId: imageId,
        requestId: request.id,
      });
      const query = request.query as { force?: boolean };
      const operation = await operations.run(
        {
          kind: "image.delete",
          hostId,
          idempotencyKey: getIdempotencyKey(request),
          requestId: request.id,
        },
        (signal) =>
          registry.deleteImage(hostId, imageId, query.force ?? false, signal),
      );
      audit.record({
        actorId: user.id,
        action: "image.delete",
        hostId,
        resourceKind: "image",
        resourceId: imageId,
        result: operation.status === "succeeded" ? "success" : "failure",
        requestId: request.id,
      });
      return sendData(reply, operation, 202);
    },
  );

  app.post(
    "/api/v1/hosts/:hostId/prune/:kind",
    { schema: { params: pruneParams, querystring: pruneQuery } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId, kind } = request.params as {
        hostId: string;
        kind: PruneResourceKind;
      };
      assertHostAccess(user, hostId, {
        action: `prune.${kind}`,
        resourceKind: kind,
        requestId: request.id,
      });
      requireRole(auth, audit, user, "operator", {
        action: `prune.${kind}`,
        hostId,
        resourceKind: kind,
        requestId: request.id,
      });
      const { all } = request.query as { all?: boolean };
      const operation = await operations.run(
        {
          kind: `prune.${kind}`,
          hostId,
          ...(getOperationId(request)
            ? { operationId: getOperationId(request) }
            : {}),
          idempotencyKey: getIdempotencyKey(request),
          requestId: request.id,
        },
        async (signal) => {
          await registry.pruneResources(hostId, kind, all ?? false, signal);
        },
      );
      audit.record({
        actorId: user.id,
        action: `prune.${kind}`,
        hostId,
        resourceKind: kind,
        result: operation.status === "succeeded" ? "success" : "failure",
        requestId: request.id,
      });
      return sendData(reply, operation, 202);
    },
  );

  app.get(
    "/api/v1/hosts/:hostId/volumes",
    { schema: { params: hostParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId } = request.params as { hostId: string };
      assertHostAccess(user, hostId, {
        action: "volume.list",
        requestId: request.id,
      });
      return sendData(reply, await registry.listVolumes(hostId));
    },
  );

  app.post(
    "/api/v1/hosts/:hostId/volumes",
    { schema: { params: hostParams, body: volumeCreateBody } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId } = request.params as { hostId: string };
      assertHostAccess(user, hostId, {
        action: "volume.create",
        resourceKind: "volume",
        requestId: request.id,
      });
      requireRole(auth, audit, user, "operator", {
        action: "volume.create",
        hostId,
        resourceKind: "volume",
        requestId: request.id,
      });
      const body = request.body as VolumeCreateInput;
      const operation = await operations.run(
        {
          kind: "volume.create",
          hostId,
          idempotencyKey: getIdempotencyKey(request),
          requestId: request.id,
        },
        (signal) =>
          registry.createVolume(
            hostId,
            {
              name: body.name.trim(),
              ...(body.driver?.trim() ? { driver: body.driver.trim() } : {}),
            },
            signal,
          ),
      );
      audit.record({
        actorId: user.id,
        action: "volume.create",
        hostId,
        resourceKind: "volume",
        resourceId: body.name,
        result: operation.status === "succeeded" ? "success" : "failure",
        requestId: request.id,
      });
      return sendData(reply, operation, 202);
    },
  );

  app.get(
    "/api/v1/hosts/:hostId/volumes/:volumeName/inspect",
    { schema: { params: volumeParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId, volumeName } = request.params as {
        hostId: string;
        volumeName: string;
      };
      assertHostAccess(user, hostId, {
        action: "volume.inspect",
        resourceKind: "volume",
        resourceId: volumeName,
        requestId: request.id,
      });
      return sendData(reply, await registry.inspectVolume(hostId, volumeName));
    },
  );

  app.delete(
    "/api/v1/hosts/:hostId/volumes/:volumeName",
    { schema: { params: volumeParams, querystring: forceQuery } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId, volumeName } = request.params as {
        hostId: string;
        volumeName: string;
      };
      assertHostAccess(user, hostId, {
        action: "volume.delete",
        resourceKind: "volume",
        resourceId: volumeName,
        requestId: request.id,
      });
      requireRole(auth, audit, user, "admin", {
        action: "volume.delete",
        hostId,
        resourceKind: "volume",
        resourceId: volumeName,
        requestId: request.id,
      });
      const query = request.query as { force?: boolean };
      const operation = await operations.run(
        {
          kind: "volume.delete",
          hostId,
          idempotencyKey: getIdempotencyKey(request),
          requestId: request.id,
        },
        (signal) =>
          registry.deleteVolume(
            hostId,
            volumeName,
            query.force ?? false,
            signal,
          ),
      );
      audit.record({
        actorId: user.id,
        action: "volume.delete",
        hostId,
        resourceKind: "volume",
        resourceId: volumeName,
        result: operation.status === "succeeded" ? "success" : "failure",
        requestId: request.id,
      });
      return sendData(reply, operation, 202);
    },
  );

  app.get(
    "/api/v1/hosts/:hostId/networks",
    { schema: { params: hostParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId } = request.params as { hostId: string };
      assertHostAccess(user, hostId, {
        action: "network.list",
        requestId: request.id,
      });
      return sendData(reply, await registry.listNetworks(hostId));
    },
  );

  app.post(
    "/api/v1/hosts/:hostId/networks",
    { schema: { params: hostParams, body: networkCreateBody } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId } = request.params as { hostId: string };
      assertHostAccess(user, hostId, {
        action: "network.create",
        resourceKind: "network",
        requestId: request.id,
      });
      requireRole(auth, audit, user, "operator", {
        action: "network.create",
        hostId,
        resourceKind: "network",
        requestId: request.id,
      });
      const body = request.body as NetworkCreateInput;
      const operation = await operations.run(
        {
          kind: "network.create",
          hostId,
          idempotencyKey: getIdempotencyKey(request),
          requestId: request.id,
        },
        (signal) =>
          registry.createNetwork(
            hostId,
            {
              name: body.name.trim(),
              ...(body.driver?.trim() ? { driver: body.driver.trim() } : {}),
              internal: body.internal ?? false,
            },
            signal,
          ),
      );
      audit.record({
        actorId: user.id,
        action: "network.create",
        hostId,
        resourceKind: "network",
        resourceId: body.name,
        result: operation.status === "succeeded" ? "success" : "failure",
        requestId: request.id,
      });
      return sendData(reply, operation, 202);
    },
  );

  app.get(
    "/api/v1/hosts/:hostId/networks/:networkId/inspect",
    { schema: { params: networkParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId, networkId } = request.params as {
        hostId: string;
        networkId: string;
      };
      assertHostAccess(user, hostId, {
        action: "network.inspect",
        resourceKind: "network",
        resourceId: networkId,
        requestId: request.id,
      });
      return sendData(reply, await registry.inspectNetwork(hostId, networkId));
    },
  );

  app.delete(
    "/api/v1/hosts/:hostId/networks/:networkId",
    { schema: { params: networkParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId, networkId } = request.params as {
        hostId: string;
        networkId: string;
      };
      assertHostAccess(user, hostId, {
        action: "network.delete",
        resourceKind: "network",
        resourceId: networkId,
        requestId: request.id,
      });
      requireRole(auth, audit, user, "operator", {
        action: "network.delete",
        hostId,
        resourceKind: "network",
        resourceId: networkId,
        requestId: request.id,
      });
      const operation = await operations.run(
        {
          kind: "network.delete",
          hostId,
          idempotencyKey: getIdempotencyKey(request),
          requestId: request.id,
        },
        (signal) => registry.deleteNetwork(hostId, networkId, signal),
      );
      audit.record({
        actorId: user.id,
        action: "network.delete",
        hostId,
        resourceKind: "network",
        resourceId: networkId,
        result: operation.status === "succeeded" ? "success" : "failure",
        requestId: request.id,
      });
      return sendData(reply, operation, 202);
    },
  );

  app.post(
    "/api/v1/hosts/:hostId/containers/:containerId/:action",
    { schema: { params: actionParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId, containerId, action } = request.params as {
        hostId: string;
        containerId: string;
        action: "start" | "stop" | "restart" | "pause" | "unpause" | "kill";
      };
      assertHostAccess(user, hostId, {
        action: `container.${action}`,
        resourceKind: "container",
        resourceId: containerId,
        requestId: request.id,
      });
      requireRole(auth, audit, user, "operator", {
        action: `container.${action}`,
        hostId,
        resourceKind: "container",
        resourceId: containerId,
        requestId: request.id,
      });
      const operation = await operations.run(
        {
          kind: `container.${action}`,
          hostId,
          idempotencyKey: getIdempotencyKey(request),
          requestId: request.id,
        },
        (signal) =>
          registry.containerAction(hostId, containerId, action, signal),
      );
      audit.record({
        actorId: user.id,
        action: `container.${action}`,
        hostId,
        resourceKind: "container",
        resourceId: containerId,
        result: operation.status === "succeeded" ? "success" : "failure",
        requestId: request.id,
      });
      return sendData(reply, operation, 202);
    },
  );

  app.delete(
    "/api/v1/hosts/:hostId/containers/:containerId",
    {
      schema: {
        params: containerParams,
        querystring: Type.Object({ force: Type.Optional(Type.Boolean()) }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { hostId, containerId } = request.params as {
        hostId: string;
        containerId: string;
      };
      assertHostAccess(user, hostId, {
        action: "container.delete",
        resourceKind: "container",
        resourceId: containerId,
        requestId: request.id,
      });
      requireRole(auth, audit, user, "operator", {
        action: "container.delete",
        hostId,
        resourceKind: "container",
        resourceId: containerId,
        requestId: request.id,
      });
      const query = request.query as { force?: boolean };
      const operation = await operations.run(
        {
          kind: "container.delete",
          hostId,
          idempotencyKey: getIdempotencyKey(request),
          requestId: request.id,
        },
        (signal) =>
          registry.deleteContainer(
            hostId,
            containerId,
            query.force ?? false,
            signal,
          ),
      );
      audit.record({
        actorId: user.id,
        action: "container.delete",
        hostId,
        resourceKind: "container",
        resourceId: containerId,
        result: operation.status === "succeeded" ? "success" : "failure",
        requestId: request.id,
      });
      return sendData(reply, operation, 202);
    },
  );

  app.get(
    "/api/v1/operations/:operationId",
    { schema: { params: operationParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { operationId } = request.params as { operationId: string };
      const operation = operations.get(operationId);
      if (operation.hostId)
        assertHostAccess(user, operation.hostId, {
          action: "operation.read",
          resourceKind: "operation",
          resourceId: operationId,
          requestId: request.id,
        });
      return sendData(reply, operation);
    },
  );

  app.post(
    "/api/v1/operations/:operationId/cancel",
    { schema: { params: operationParams } },
    async (request, reply) => {
      const user = await requireUser(auth, request);
      const { operationId } = request.params as { operationId: string };
      const current = operations.get(operationId);
      if (current.hostId)
        assertHostAccess(user, current.hostId, {
          action: "operation.cancel",
          resourceKind: "operation",
          resourceId: operationId,
          requestId: request.id,
        });
      requireRole(auth, audit, user, "operator", {
        action: "operation.cancel",
        resourceKind: "operation",
        resourceId: operationId,
        requestId: request.id,
      });
      const operation = await operations.cancel(operationId);
      audit.record({
        actorId: user.id,
        action: "operation.cancel",
        hostId: operation.hostId,
        resourceKind: "operation",
        resourceId: operationId,
        result: operation.status === "cancelled" ? "success" : "failure",
        requestId: request.id,
      });
      return sendData(reply, operation);
    },
  );

  app.get(
    "/api/v1/stream",
    { websocket: true, schema: { querystring: streamQuery } },
    async (socket, request) => {
      const query = request.query as {
        cursor?: string;
        hostId?: string;
        ticket?: string;
      };
      const user = await auth.authenticateWebSocket(request, query.ticket);
      if (!user) {
        socket.close(1008, "Authentication is required");
        return;
      }
      const hostId = query.hostId;
      const allowedHostIds = new Set(
        auth.permissions(
          user,
          registry.list().map((host) => host.id),
        ).hostIds,
      );
      if (hostId && !allowedHostIds.has(hostId)) {
        socket.close(1008, "Host access denied");
        return;
      }
      const send = (event: unknown) => {
        if (socket.readyState === 1) socket.send(JSON.stringify(event));
      };
      const matches = (event: { hostId?: string }) =>
        !hostId || event.hostId === hostId;
      for (const event of events.since(query.cursor))
        if (matches(event)) send(event);
      const unsubscribe = events.subscribe((event) => {
        if (matches(event)) send(event);
      });
      // Keep the stream alive through proxies and VPNs that close idle TCP
      // connections. The browser answers protocol-level ping frames without
      // exposing a long-lived bearer token or adding fake event records.
      const heartbeat = setInterval(() => {
        if (socket.readyState === 1) socket.ping();
      }, 25_000);
      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearInterval(heartbeat);
        unsubscribe();
      };
      socket.on("close", cleanup);
      socket.on("error", cleanup);
    },
  );

  app.get(
    "/api/v1/terminal/:sessionId",
    {
      websocket: true,
      schema: { params: terminalParams, querystring: streamQuery },
    },
    async (socket, request) => {
      const query = request.query as { ticket?: string };
      const user = await auth.authenticateWebSocket(request, query.ticket);
      if (!user) {
        socket.close(1008, "Authentication is required");
        return;
      }
      const { sessionId } = request.params as { sessionId: string };
      const session = registry.getTerminalSession(sessionId);
      if (
        !auth
          .permissions(
            user,
            registry.list().map((host) => host.id),
          )
          .hostIds.includes(session.session.hostId)
      ) {
        socket.close(1008, "Host access denied");
        return;
      }

      const send = (frame: TerminalFrame) => {
        if (socket.readyState === 1) socket.send(JSON.stringify(frame));
      };
      const onMessage = (raw: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const frame = JSON.parse(
            Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw),
          ) as TerminalFrame;
          if (frame.type === "resize") {
            void registry
              .resizeTerminalSession(sessionId, frame.rows, frame.columns)
              .catch(() =>
                send({
                  type: "error",
                  code: "resize_failed",
                  message: "Terminal resize was rejected.",
                }),
              );
          } else if (frame.type === "keepalive") {
            send({ type: "keepalive" });
          }
        } catch {
          send({
            type: "error",
            code: "invalid_frame",
            message: "The terminal frame was invalid.",
          });
        }
      };
      socket.on("message", onMessage);
      socket.on("close", () => registry.closeTerminalSession(sessionId));
      try {
        const stream = await registry.startTerminalSession(sessionId);
        for await (const chunk of stream)
          send({
            type: "stdout",
            data: Buffer.isBuffer(chunk)
              ? chunk.toString("utf8")
              : String(chunk),
          });
        send({ type: "exit", code: 0 });
        registry.closeTerminalSession(sessionId);
        if (socket.readyState === 1) socket.close(1000, "Command completed");
      } catch {
        send({
          type: "error",
          code: "terminal_failed",
          message: "The remote terminal session failed.",
        });
        registry.closeTerminalSession(sessionId);
        if (socket.readyState === 1) socket.close(1011, "Terminal failed");
      }
    },
  );

  app.addHook("onClose", async () => {
    await registry.close();
  });

  await registry.start();
  return { app, registry, events, operations, audit };
}
