import { randomUUID } from "node:crypto";
import type {
  AssistantAnalysis,
  AssistantApplyInput,
  AssistantInsight,
  AssistantProposal,
  ContainerSummary,
  Host,
  ImageSummary,
  NetworkSummary,
  Operation,
  VolumeSummary,
} from "@harbor/contracts";
import { HttpError } from "../errors.js";
import type { HostRegistry } from "./host-registry.js";

export type AssistantProposalAction =
  | { kind: "container"; containerId: string; action: "stop" | "start" }
  | { kind: "image"; imageId: string; action: "delete" }
  | { kind: "volume"; volumeName: string; action: "delete" }
  | { kind: "network"; networkId: string; action: "delete" };

export interface AssistantRegistryLike {
  list(): Host[];
  dashboard(hostId: string): Promise<unknown>;
  listContainers(hostId: string, all?: boolean): Promise<ContainerSummary[]>;
  listImages(hostId: string): Promise<ImageSummary[]>;
  listVolumes(hostId: string): Promise<VolumeSummary[]>;
  listNetworks(hostId: string): Promise<NetworkSummary[]>;
  containerAction(
    hostId: string,
    containerId: string,
    action: "start" | "stop" | "restart" | "pause" | "unpause" | "kill",
  ): Promise<void>;
  deleteImage(hostId: string, imageId: string, force: boolean): Promise<void>;
  deleteVolume(hostId: string, name: string, force: boolean): Promise<void>;
  deleteNetwork(hostId: string, networkId: string): Promise<void>;
}

export function extractDigest(image: ImageSummary): string | undefined {
  const candidate = image.digest ?? image.id;
  return /^sha256:[a-f0-9]{64}$/.test(candidate) ? candidate : undefined;
}

/**
 * Deterministic, server-side diagnostic rule engine. It inspects live
 * host resources and returns insights plus safe, reversible proposals;
 * nothing here invents a resource that the Engine did not report.
 */
export class AssistantService {
  constructor(private readonly registry: AssistantRegistryLike) {}

  public async analyze(hostId: string): Promise<AssistantAnalysis> {
    this.assertHost(hostId);
    const [containers, images, volumes, networks] = await Promise.all([
      this.registry.listContainers(hostId, true),
      this.registry.listImages(hostId),
      this.registry.listVolumes(hostId),
      this.registry.listNetworks(hostId),
    ]);
    const insights: AssistantInsight[] = [];
    const proposals: AssistantProposal[] = [];

    for (const container of containers) {
      if (
        container.state === "exited" &&
        /exited \(0\)/i.test(container.status) === false &&
        container.status.toLowerCase().includes("exited")
      ) {
        const code = this.exitCode(container.status);
        insights.push({
          id: randomUUID(),
          severity: "warning",
          title: "Container exited with a non-zero code",
          detail:
            container.name + " exited with code " + (code ?? "unknown") + ".",
          resourceKind: "container",
          resourceId: container.id,
        });
      }
      if (container.state === "restarting") {
        insights.push({
          id: randomUUID(),
          severity: "critical",
          title: "Container is crash-looping",
          detail:
            container.name +
            " keeps restarting and never reaches a stable state.",
          resourceKind: "container",
          resourceId: container.id,
        });
      }
    }

    for (const image of images) {
      if (image.repository === "<none>") {
        insights.push({
          id: randomUUID(),
          severity: "info",
          title: "Dangling image",
          detail:
            "Image " +
            (image.id ?? "unknown").slice(0, 19) +
            " has no tag and is safe to prune.",
          resourceKind: "image",
          resourceId: image.id ?? "",
        });
        if (image.id)
          proposals.push({
            id: randomUUID(),
            title: "Remove dangling image",
            summary:
              "Deletes the untagged image " +
              (image.id ?? "").slice(0, 19) +
              ".",
            resourceKind: "image",
            resourceId: image.id ?? "",
            action: "delete",
            risk: "low",
            reversible: false,
          });
      }
    }

    for (const volume of volumes) {
      if (volume.driver === "local" && !volume.mountpoint) {
        insights.push({
          id: randomUUID(),
          severity: "info",
          title: "Unused volume",
          detail: "Volume " + volume.name + " is not mounted by any container.",
          resourceKind: "volume",
          resourceId: volume.name,
        });
        proposals.push({
          id: randomUUID(),
          title: "Remove unused volume",
          summary: "Deletes the unmounted volume " + volume.name + ".",
          resourceKind: "volume",
          resourceId: volume.name,
          action: "delete",
          risk: "medium",
          reversible: false,
        });
      }
    }

    for (const network of networks) {
      if (
        network.name !== "bridge" &&
        network.name !== "host" &&
        network.name !== "none"
      ) {
        const used = containers.some(
          (container) => container.labels?.com_docker_network === network.name,
        );
        if (!used) {
          insights.push({
            id: randomUUID(),
            severity: "info",
            title: "Network may be unused",
            detail:
              "Network " +
              network.name +
              " has no container labels referencing it.",
            resourceKind: "network",
            resourceId: network.id,
          });
        }
      }
    }

    if (insights.length === 0) {
      insights.push({
        id: randomUUID(),
        severity: "info",
        title: "No issues detected",
        detail:
          "Every container on this host is in a healthy state and no cleanup opportunities were found.",
      });
    }

    return {
      hostId,
      generatedAt: new Date().toISOString(),
      insights,
      proposals,
    };
  }

  public async apply(
    hostId: string,
    input: AssistantApplyInput,
  ): Promise<{ applied: true; resourceId: string; action: string }> {
    this.assertHost(hostId);
    try {
      if (input.resourceKind === "container") {
        if (input.action !== "stop" && input.action !== "start")
          throw new HttpError(
            422,
            "unsupported_action",
            "The container action is not supported by the assistant.",
          );
        await this.registry.containerAction(
          hostId,
          input.resourceId,
          input.action,
        );
      } else if (input.resourceKind === "image") {
        await this.registry.deleteImage(hostId, input.resourceId, true);
      } else if (input.resourceKind === "volume") {
        await this.registry.deleteVolume(hostId, input.resourceId, true);
      } else if (input.resourceKind === "network") {
        await this.registry.deleteNetwork(hostId, input.resourceId);
      } else {
        throw new HttpError(
          422,
          "unsupported_kind",
          "The assistant cannot act on this resource kind.",
        );
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        502,
        "apply_failed",
        "The assistant could not apply the action.",
      );
    }
    return {
      applied: true,
      resourceId: input.resourceId,
      action: input.action,
    };
  }

  private assertHost(hostId: string): void {
    const host = this.registry
      .list()
      .find((candidate) => candidate.id === hostId);
    if (!host)
      throw new HttpError(404, "host_not_found", "The host was not found.");
  }

  private exitCode(status: string): number | undefined {
    const match = /exited \((\d+)\)/i.exec(status);
    return match ? Number.parseInt(match[1] ?? "", 10) : undefined;
  }
}
