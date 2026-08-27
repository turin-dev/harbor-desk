import { Queue, Worker, type JobsOptions } from "bullmq";

export type OperationJobKind =
  | "build"
  | "compose"
  | "volume-export"
  | "volume-import"
  | "image-scan"
  | "extension-install";

export interface OperationJob {
  operationId: string;
  kind: OperationJobKind;
  hostId?: string;
  payload: Record<string, unknown>;
}

export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

export function parseRedisUrl(value: string): RedisConnectionOptions {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
  };
}

export function createOperationQueue(redisUrl: string): Queue<OperationJob> {
  return new Queue<OperationJob>("harbor-operations", {
    connection: parseRedisUrl(redisUrl),
  });
}

export async function enqueueOperation(
  queue: Queue<OperationJob>,
  job: OperationJob,
  options?: JobsOptions,
): Promise<string> {
  const queued = await queue.add(job.kind, job, {
    jobId: job.operationId,
    removeOnComplete: 100,
    removeOnFail: 100,
    ...options,
  });
  return queued.id ?? job.operationId;
}

export function startWorker(
  redisUrl: string,
  processor: (job: OperationJob) => Promise<void>,
): Worker<OperationJob> {
  return new Worker<OperationJob>(
    "harbor-operations",
    async (job) => processor(job.data),
    {
      connection: parseRedisUrl(redisUrl),
      concurrency: 4,
    },
  );
}

const redisUrl = process.env.REDIS_URL;
if (
  redisUrl &&
  process.env.ENABLE_OPERATION_WORKER === "true" &&
  process.env.NODE_ENV !== "test"
) {
  const worker = startWorker(redisUrl, async (job) => {
    throw new Error(
      `No processor registered for ${job.kind}; operation ${job.operationId} remains unhandled.`,
    );
  });
  worker.on("failed", (job, error) => {
    console.error("Harbor operation failed", {
      operationId: job?.data.operationId,
      error: error.message,
    });
  });
  process.once("SIGTERM", () => void worker.close());
  process.once("SIGINT", () => void worker.close());
} else if (process.env.NODE_ENV !== "test") {
  console.info(
    redisUrl
      ? "Harbor worker is idle: operation processors are not enabled."
      : "Harbor worker is idle: REDIS_URL is not configured.",
  );
}
