import type {
  ImageScanReport,
  ImageScanSeverity,
  Operation,
} from "@harbor/contracts";

const SEVERITY_ORDER: ImageScanSeverity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "UNKNOWN",
];

const SEVERITY_LABEL: Record<ImageScanSeverity, string> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  UNKNOWN: "unknown",
};

export function worstSeverity(
  report: ImageScanReport,
): ImageScanSeverity | undefined {
  if (!report.vulnerabilities.length) return undefined;
  let worst: ImageScanSeverity = "UNKNOWN";
  let worstRank = SEVERITY_ORDER.length;
  for (const vulnerability of report.vulnerabilities) {
    const rank = SEVERITY_ORDER.indexOf(vulnerability.severity);
    if (rank < worstRank) {
      worstRank = rank;
      worst = vulnerability.severity;
    }
  }
  return worst;
}

export function severitySummary(report: ImageScanReport): string {
  const parts: string[] = [];
  for (const severity of SEVERITY_ORDER) {
    const count = report.counts[severity] ?? 0;
    if (count > 0) parts.push(count + " " + SEVERITY_LABEL[severity]);
  }
  if (!parts.length) return "0 vulnerabilities";
  return parts.join(", ");
}

export function topVulnerabilities(
  report: ImageScanReport,
  limit = 10,
): ImageScanReport["vulnerabilities"] {
  const rank = (severity: ImageScanSeverity) =>
    SEVERITY_ORDER.indexOf(severity);
  return [...report.vulnerabilities]
    .sort(
      (a, b) =>
        rank(a.severity) - rank(b.severity) ||
        a.vulnerabilityId.localeCompare(b.vulnerabilityId),
    )
    .slice(0, limit);
}

export interface ScanOutcomeCopy {
  tone: "success" | "info" | "error";
  title: string;
  body: string;
}

export function describeScanOutcome(
  operation: Operation | undefined,
  report?: ImageScanReport,
): ScanOutcomeCopy | undefined {
  if (!operation) return undefined;
  if (operation.status === "succeeded" && report) {
    const worst = worstSeverity(report);
    if (report.partial)
      return {
        tone: "info",
        title: "Scan finished (partial report)",
        body: "The Trivy container finished, but its report could not be parsed into vulnerability rows. The raw scan output is not retained by the gateway.",
      };
    if (!report.vulnerabilities.length)
      return {
        tone: "success",
        title: "No vulnerabilities found",
        body: "Trivy reported no vulnerabilities for the requested severities.",
      };
    return {
      tone: worst === "CRITICAL" || worst === "HIGH" ? "error" : "info",
      title: severitySummary(report),
      body: "Top vulnerabilities are listed below. Fix versions are shown when Trivy reports one.",
    };
  }
  if (operation.status === "succeeded")
    return {
      tone: "info",
      title: "Scan finished",
      body: "The scan operation succeeded; the report is still loading.",
    };
  if (operation.status === "cancelled")
    return {
      tone: "info",
      title: "Scan cancelled",
      body: "The Trivy scan container was stopped and removed from the host.",
    };
  if (operation.status === "failed")
    return {
      tone: "error",
      title: "Scan failed",
      body:
        operation.error?.message ??
        operation.message ??
        "The Trivy scan could not be completed.",
    };
  return undefined;
}
