import {
  request as httpRequest,
  type RequestOptions as HttpRequestOptions,
} from "node:http";
import {
  request as httpsRequest,
  type RequestOptions as HttpsRequestOptions,
} from "node:https";
import { Buffer } from "node:buffer";
import type { EngineTlsMaterial } from "./index.js";

export interface K8sClientOptions {
  endpoint: string;
  token?: string;
  tls?: EngineTlsMaterial;
  timeoutMs?: number;
}

interface RawK8sList<T> {
  items?: T[];
}

interface RawK8sPod {
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
  };
  spec?: { nodeName?: string };
  status?: {
    phase?: string;
    containerStatuses?: Array<{
      name?: string;
      image?: string;
      ready?: boolean;
      restartCount?: number;
    }>;
  };
}

export class K8sApiError extends Error {
  public readonly statusCode: number;
  public readonly body?: string;

  constructor(message: string, statusCode: number, body?: string) {
    super(message);
    this.name = "K8sApiError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

/**
 * Minimal read-only Kubernetes API client. It talks to the cluster API
 * server over HTTPS (with bearer token and optional mTLS) and maps the
 * wire shapes to the stable contracts used by the gateway. All calls are
 * read-only list/version requests; mutations are intentionally unsupported.
 */
export class K8sClusterClient {
  private readonly endpoint: URL;
  private readonly token?: string;
  private readonly tls?: EngineTlsMaterial;
  private readonly timeoutMs: number;

  constructor(options: K8sClientOptions) {
    this.endpoint = new URL(options.endpoint);
    if (
      this.endpoint.protocol !== "https:" &&
      this.endpoint.protocol !== "http:"
    ) {
      throw new Error("Kubernetes endpoint must use http or https");
    }
    this.token = options.token;
    this.tls = options.tls;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  public async getVersion(): Promise<Record<string, unknown>> {
    return this.requestJson<Record<string, unknown>>("/version");
  }

  public async listNamespaces(): Promise<
    RawK8sList<{ metadata?: { name?: string }; status?: { phase?: string } }>
  > {
    return this.requestJson("/api/v1/namespaces");
  }

  public async listPods(): Promise<RawK8sList<RawK8sPod>> {
    return this.requestJson("/api/v1/pods");
  }

  public async requestJson<T = unknown>(path: string): Promise<T> {
    const target = new URL(path, this.endpoint);
    const requestOptions: HttpRequestOptions &
      Pick<HttpsRequestOptions, "ca" | "cert" | "key" | "rejectUnauthorized"> =
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: target.pathname + target.search,
        method: "GET",
        headers: {
          accept: "application/json",
          ...(this.token ? { authorization: "Bearer " + this.token } : {}),
        },
        timeout: this.timeoutMs,
      };
    if (target.protocol === "https:") {
      requestOptions.ca = this.tls?.ca;
      requestOptions.cert = this.tls?.cert;
      requestOptions.key = this.tls?.key;
      requestOptions.rejectUnauthorized = true;
    }
    const request =
      target.protocol === "https:"
        ? httpsRequest(requestOptions)
        : httpRequest(requestOptions);
    return await new Promise<T>((resolve, reject) => {
      request.once("response", (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const status = response.statusCode ?? 0;
          if (status >= 400) {
            reject(
              new K8sApiError(
                "Kubernetes API returned HTTP " + status,
                status,
                body,
              ),
            );
            return;
          }
          if (!body) {
            resolve(undefined as T);
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(
              new K8sApiError(
                "Kubernetes API returned a non-JSON body",
                status,
                body,
              ),
            );
          }
        });
        response.on("error", (error: Error) => reject(error));
      });
      request.once("error", (error: Error) => reject(error));
      request.once("timeout", () =>
        request.destroy(
          new Error(
            "Kubernetes API request timed out after " + this.timeoutMs + "ms",
          ),
        ),
      );
      request.end();
    });
  }
}
