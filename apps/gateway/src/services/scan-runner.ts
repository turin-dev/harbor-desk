import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type {
  ImageScanInput,
  ImageScanReport,
  ImageScanSeverity,
  ImageScanVulnerability,
} from "@harbor/contracts";
import type { HostRegistry } from "./host-registry.js";
import { HttpError } from "../errors.js";

export const DEFAULT_SCANNER_IMAGE = "aquasec/trivy:0.58.2";
export const SCAN_TIMEOUT_MS = 10 * 60 * 1000;
export const SCAN_POLL_INTERVAL_MS = 1000;
const MAX_VULNERABILITIES = 200;

const SEVERITIES: ImageScanSeverity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "UNKNOWN",
];

function emptyCounts(): Record<ImageScanSeverity, number> {
  return { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
}

/**
 * Trivy ships its own ENTRYPOINT (\`trivy\`), so the scan container must
 * pass the argv verbatim (\`rawCommand\`). The default \`sh -lc\` wrapper
 * would make \`sh\` an argument of trivy and the scan would fail with
 * \`unknown shorthand flag: 'l' in -lc\`.
 */
export function buildTrivyArgs(input: ImageScanInput): string[] {
  const severities = (input.severities ?? "CRITICAL,HIGH,MEDIUM,LOW")
    .split(/[\s,]+/)
    .filter((item) => item.length > 0)
    .join(",");
  return [
    "image",
    "--quiet",
    "--format",
    "json",
    "--severity",
    severities,
    input.image,
  ];
}

function normalizeSeverity(value: unknown): ImageScanSeverity {
  const upper = typeof value === "string" ? value.toUpperCase() : "";
  return SEVERITIES.find((item) => item === upper) ?? "UNKNOWN";
}

function parseVulnerability(
  raw: Record<string, unknown>,
): ImageScanVulnerability {
  const asText = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;
  return {
    vulnerabilityId: asText(raw.ID) ?? "UNKNOWN",
    package: asText(raw.PkgName),
    installedVersion: asText(raw.InstalledVersion),
    fixedVersion: asText(raw.FixedVersion),
    severity: normalizeSeverity(raw.Severity),
    title: asText(raw.Title),
    description: asText(raw.Description),
  };
}

/**
 * Trivy writes its JSON report to stdout, but the Engine container logs
 * endpoint mixes stdout and stderr with stream headers, so the JSON must be
 * sliced out of the raw text. Tries the outermost braces first, then walks
 * the final brace backwards to drop trailing non-JSON noise.
 */
export function parseTrivyReport(
  raw: string,
  context: {
    image: string;
    scannerImage: string;
    startedAt: string;
    imageId?: string;
  },
): ImageScanReport {
  const base: ImageScanReport = {
    image: context.image,
    ...(context.imageId ? { imageId: context.imageId } : {}),
    scannerImage: context.scannerImage,
    startedAt: context.startedAt,
    finishedAt: new Date().toISOString(),
    totalVulnerabilities: 0,
    counts: emptyCounts(),
    partial: true,
    vulnerabilities: [],
  };
  const first = raw.indexOf("{");
  if (first < 0) return base;

  let parsed: unknown;
  let source = raw;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const last = source.lastIndexOf("}");
    if (last <= first) return base;
    try {
      parsed = JSON.parse(source.slice(first, last + 1));
      break;
    } catch {
      parsed = undefined;
      const next = source.lastIndexOf("}", last - 1);
      if (next <= first) return base;
      source = source.slice(0, next + 1);
    }
  }

  if (typeof parsed !== "object" || parsed === null) return base;
  const results = (parsed as { Results?: unknown }).Results;
  if (!Array.isArray(results)) return base;

  const vulnerabilities: ImageScanVulnerability[] = [];
  for (const result of results) {
    if (typeof result !== "object" || result === null) continue;
    const rows = (result as { Vulnerabilities?: unknown }).Vulnerabilities;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (typeof row !== "object" || row === null) continue;
      vulnerabilities.push(parseVulnerability(row as Record<string, unknown>));
      if (vulnerabilities.length >= MAX_VULNERABILITIES) break;
    }
    if (vulnerabilities.length >= MAX_VULNERABILITIES) break;
  }

  const counts = emptyCounts();
  for (const vulnerability of vulnerabilities)
    counts[vulnerability.severity] += 1;

  return {
    ...base,
    partial: false,
    totalVulnerabilities: vulnerabilities.length,
    counts,
    vulnerabilities,
  };
}

function isMissingImage(error: unknown): boolean {
  if (error instanceof HttpError)
    return error.statusCode === 404 || error.code === "resource_not_found";
  if (error instanceof Error && error.name === "EngineRequestError")
    return true;
  return (
    error instanceof Error && /not found|no such image/i.test(error.message)
  );
}

export class ImageScanService {
  private readonly reports = new Map<string, ImageScanReport>();

  constructor(private readonly registry: HostRegistry) {}

  public store(operationId: string, report: ImageScanReport): void {
    this.reports.set(operationId, report);
  }

  public getReport(operationId: string): ImageScanReport | undefined {
    return this.reports.get(operationId);
  }

  public async run(args: {
    hostId: string;
    input: ImageScanInput;
    signal?: AbortSignal;
    onProgress?: (percent: number, message: string) => void;
  }): Promise<ImageScanReport> {
    const { hostId, input, signal } = args;
    const onProgress = args.onProgress ?? (() => undefined);
    const scannerImage = input.scannerImage ?? DEFAULT_SCANNER_IMAGE;
    const startedAt = new Date().toISOString();

    onProgress(5, "Checking the scanner image on the remote host.");
    try {
      await this.registry.inspectImage(hostId, scannerImage);
    } catch (error) {
      if (signal?.aborted) throw this.cancelled();
      if (!isMissingImage(error)) throw error;
      await this.registry.pullImage(
        hostId,
        { image: scannerImage },
        (frame) => {
          const label = frame.id ? frame.status + " " + frame.id : frame.status;
          if (frame.status === "Pull complete")
            onProgress(30, "Scanner image ready.");
          else onProgress(10, "Pulling the scanner image: " + label);
        },
        signal,
      );
    }

    let imageId: string | undefined;
    try {
      const images = await this.registry.listImages(hostId);
      const match = images.find(
        (item) => item.repository + ":" + item.tag === input.image,
      );
      imageId = match?.id;
    } catch {
      imageId = undefined;
    }

    onProgress(35, "Starting the Trivy scan container.");
    const name = "harbor-scan-" + randomUUID().slice(0, 8);
    const containerId = await this.registry.createContainer(
      hostId,
      {
        image: scannerImage,
        name,
        rawCommand: buildTrivyArgs(input),
        labels: { "harbor.desk/scan": "image" },
      },
      signal,
    );
    try {
      await this.registry.containerAction(hostId, containerId, "start", signal);
      const deadline = Date.now() + SCAN_TIMEOUT_MS;
      for (;;) {
        if (signal?.aborted) throw this.cancelled();
        if (Date.now() > deadline)
          throw new HttpError(
            504,
            "scan_timeout",
            "The Trivy scan did not finish within ten minutes.",
          );
        await delay(SCAN_POLL_INTERVAL_MS, { signal });
        if (signal?.aborted) throw this.cancelled();
        const state = await this.registry.inspectContainer(hostId, containerId);
        const status = ((state as { State?: { Status?: unknown } }).State ?? {})
          .Status;
        if (status === "exited" || status === "dead") {
          onProgress(85, "Reading the scan report.");
          const logs = await this.registry.containerLogs(
            hostId,
            containerId,
            "5000",
            false,
          );
          const report = parseTrivyReport(logs, {
            image: input.image,
            scannerImage,
            startedAt,
            imageId,
          });
          const exitCode = (
            (state as { State?: { ExitCode?: unknown } }).State ?? {}
          ).ExitCode;
          if (report.partial && exitCode !== 0)
            throw new HttpError(
              502,
              "scan_failed",
              "The scanner exited with code " +
                String(exitCode) +
                " before producing a report.",
            );
          onProgress(100, "Scan finished.");
          return report;
        }
      }
    } finally {
      if (signal?.aborted) {
        try {
          await this.registry.containerAction(hostId, containerId, "kill");
        } catch {
          // best effort; the force delete follows
        }
      }
      try {
        await this.registry.deleteContainer(hostId, containerId, true, signal);
      } catch {
        // best effort cleanup
      }
    }
  }

  private cancelled(): Error {
    return Object.assign(new Error("Scan cancelled."), {
      code: "operation_cancelled",
    });
  }
}
