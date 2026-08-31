import { randomUUID } from "node:crypto";
import type {
  K8sCluster,
  K8sClusterRegistrationInput,
  K8sNamespace,
  K8sPod,
} from "@harbor/contracts";
import type { GatewayConfig } from "@harbor/config";
import { K8sApiError, K8sClusterClient } from "@harbor/connectors";
import { HttpError } from "../errors.js";
import {
  MemoryEncryptedSecretStore,
  type SecretStore,
} from "./secret-store.js";

interface K8sRecord {
  publicCluster: K8sCluster;
  client: K8sClusterClient;
  secretReference?: string;
  lastError?: string;
}

export interface K8sRegistryOptions {
  config: GatewayConfig;
  secrets?: SecretStore;
}

interface RawNamespaceItem {
  metadata?: { name?: string };
  status?: { phase?: string };
}

interface RawPodItem {
  metadata?: { name?: string; namespace?: string; creationTimestamp?: string };
  spec?: { nodeName?: string };
  status?: {
    phase?: string;
    containerStatuses?: Array<{
      image?: string;
      ready?: boolean;
      restartCount?: number;
    }>;
  };
}

/**
 * Server-side registry of Kubernetes clusters. Clusters are registered
 * separately from Docker hosts; tokens and mTLS material stay in the
 * gateway secret store and the desktop client only sees the public
 * cluster metadata plus live list results.
 */
export class K8sRegistry {
  private readonly records = new Map<string, K8sRecord>();
  private readonly secrets: SecretStore;

  constructor(options: K8sRegistryOptions) {
    if (options.config.nodeEnv === "production" && !options.secrets) {
      throw new HttpError(
        503,
        "secret_store_not_configured",
        "Production requires an injected Vault/KMS-backed secret store.",
      );
    }
    this.secrets =
      options.secrets ??
      new MemoryEncryptedSecretStore(options.config.secretMasterKey);
  }

  public list(): K8sCluster[] {
    return [...this.records.values()].map((record) => ({
      ...record.publicCluster,
    }));
  }

  public get(clusterId: string): K8sRecord {
    const record = this.records.get(clusterId);
    if (!record)
      throw new HttpError(
        404,
        "cluster_not_found",
        "The Kubernetes cluster was not found.",
      );
    return record;
  }

  public async add(input: K8sClusterRegistrationInput): Promise<K8sCluster> {
    const endpoint = input.endpoint.trim();
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new HttpError(
        422,
        "invalid_cluster_endpoint",
        "The Kubernetes endpoint is not a valid URL.",
      );
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new HttpError(
        422,
        "invalid_cluster_endpoint",
        "The Kubernetes endpoint must use http or https.",
      );
    }
    const id = randomUUID();
    const hasMaterial = Boolean(
      input.token || input.ca || input.cert || input.key,
    );
    const secretReference = hasMaterial
      ? await this.secrets.put(
          JSON.stringify({
            token: input.token,
            ca: input.ca,
            cert: input.cert,
            key: input.key,
          }),
        )
      : undefined;
    const client = new K8sClusterClient({
      endpoint,
      token: input.token,
      tls:
        input.ca || input.cert || input.key
          ? { ca: input.ca, cert: input.cert, key: input.key }
          : undefined,
    });
    const record: K8sRecord = {
      client,
      secretReference,
      publicCluster: {
        id,
        displayName: input.displayName,
        endpoint,
        status: "unknown",
        connectionMode: this.connectionMode(input),
      },
    };
    this.records.set(id, record);
    await this.refresh(record);
    return { ...record.publicCluster };
  }

  public async remove(clusterId: string): Promise<void> {
    const record = this.get(clusterId);
    this.records.delete(clusterId);
    if (record.secretReference)
      await this.secrets.delete(record.secretReference);
  }

  public async test(clusterId: string): Promise<K8sCluster> {
    const record = this.get(clusterId);
    await this.refresh(record);
    return { ...record.publicCluster };
  }

  public async namespaces(clusterId: string): Promise<K8sNamespace[]> {
    const record = this.get(clusterId);
    try {
      const data = await record.client.listNamespaces();
      this.markOnline(record);
      return (data.items ?? []).map((item) => ({
        name: item.metadata?.name ?? "unknown",
        status: item.status?.phase,
      }));
    } catch (error) {
      this.markOffline(record, error);
      throw this.upstreamError(error);
    }
  }

  public async pods(clusterId: string): Promise<K8sPod[]> {
    const record = this.get(clusterId);
    try {
      const data = await record.client.listPods();
      this.markOnline(record);
      return (data.items ?? []).map((pod) => this.toPod(pod));
    } catch (error) {
      this.markOffline(record, error);
      throw this.upstreamError(error);
    }
  }

  private connectionMode(
    input: K8sClusterRegistrationInput,
  ): K8sCluster["connectionMode"] {
    const protocol = new URL(input.endpoint).protocol;
    if (protocol === "http:") return "development-http";
    if (input.ca || input.cert || input.key) return "mtls";
    return "bearer";
  }

  private async refresh(record: K8sRecord): Promise<void> {
    try {
      const version = await record.client.getVersion();
      const versionText =
        typeof version.gitVersion === "string" && version.gitVersion
          ? version.gitVersion
          : [version.major, version.minor].filter(Boolean).join(".");
      record.publicCluster = {
        ...record.publicCluster,
        status: "online",
        serverVersion: versionText || undefined,
        lastSeenAt: new Date().toISOString(),
      };
      record.lastError = undefined;
    } catch (error) {
      this.markOffline(record, error);
    }
  }

  private markOnline(record: K8sRecord): void {
    record.publicCluster = {
      ...record.publicCluster,
      status: "online",
      lastSeenAt: new Date().toISOString(),
    };
    record.lastError = undefined;
  }

  private markOffline(record: K8sRecord, error: unknown): void {
    record.publicCluster = { ...record.publicCluster, status: "offline" };
    record.lastError =
      error instanceof Error ? error.message : "Cluster probe failed";
  }

  private toPod(pod: RawPodItem): K8sPod {
    const statuses = pod.status?.containerStatuses ?? [];
    return {
      name: pod.metadata?.name ?? "unknown",
      namespace: pod.metadata?.namespace ?? "default",
      phase: pod.status?.phase ?? "Unknown",
      nodeName: pod.spec?.nodeName,
      restarts: statuses.reduce(
        (sum, item) => sum + (item.restartCount ?? 0),
        0,
      ),
      ready:
        statuses.length > 0
          ? statuses.every((item) => item.ready === true)
          : false,
      containerImage: statuses[0]?.image,
      createdAt: pod.metadata?.creationTimestamp,
    };
  }

  private upstreamError(error: unknown): HttpError {
    if (error instanceof K8sApiError) {
      if (error.statusCode === 401 || error.statusCode === 403)
        return new HttpError(
          401,
          "cluster_credentials_invalid",
          "The cluster rejected the gateway credentials.",
        );
      if (error.statusCode >= 400 && error.statusCode < 500)
        return new HttpError(
          error.statusCode,
          "cluster_rejected",
          "The Kubernetes API rejected the operation.",
        );
    }
    return new HttpError(
      502,
      "cluster_unavailable",
      "The Kubernetes cluster could not be reached.",
    );
  }
}
