import test from "node:test";
import assert from "node:assert/strict";
import type { ImageScanReport, Operation } from "@harbor/contracts";
import {
  describeScanOutcome,
  severitySummary,
  topVulnerabilities,
  worstSeverity,
} from "./scan-report.js";

function report(overrides: Partial<ImageScanReport> = {}): ImageScanReport {
  return {
    image: "nginx:1.27",
    scannerImage: "aquasec/trivy:0.58.2",
    startedAt: "2026-08-30T00:00:00.000Z",
    finishedAt: "2026-08-30T00:00:05.000Z",
    totalVulnerabilities: 3,
    counts: { CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 1, UNKNOWN: 0 },
    partial: false,
    vulnerabilities: [
      {
        vulnerabilityId: "CVE-2026-0002",
        package: "zlib",
        installedVersion: "1.2.13",
        fixedVersion: "1.3.1",
        severity: "LOW",
      },
      {
        vulnerabilityId: "CVE-2026-0001",
        package: "openssl",
        installedVersion: "3.0.9",
        fixedVersion: "3.0.13",
        severity: "CRITICAL",
      },
      {
        vulnerabilityId: "CVE-2026-0003",
        package: "zlib-ng",
        installedVersion: "2.1.0",
        fixedVersion: "",
        severity: "HIGH",
      },
    ],
    ...overrides,
  };
}

function operation(
  status: Operation["status"],
  extra: Partial<Operation> = {},
): Operation {
  return {
    id: "op-1",
    kind: "image.scan",
    status,
    ...extra,
  };
}

test("worstSeverity picks the highest severity present", () => {
  assert.equal(worstSeverity(report()), "CRITICAL");
  assert.equal(
    worstSeverity(
      report({
        vulnerabilities: [],
        counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 },
        totalVulnerabilities: 0,
      }),
    ),
    undefined,
  );
  assert.equal(
    worstSeverity(
      report({
        vulnerabilities: [
          { vulnerabilityId: "A", severity: "UNKNOWN" },
          { vulnerabilityId: "B", severity: "LOW" },
        ],
      }),
    ),
    "LOW",
  );
});

test("severitySummary lists only non-zero counts", () => {
  assert.equal(severitySummary(report()), "1 critical, 1 high, 1 low");
  assert.equal(
    severitySummary(
      report({
        vulnerabilities: [],
        totalVulnerabilities: 0,
        counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 },
      }),
    ),
    "0 vulnerabilities",
  );
});

test("topVulnerabilities sorts by severity then id and caps the list", () => {
  const top = topVulnerabilities(report(), 2);
  assert.deepEqual(
    top.map((item) => item.vulnerabilityId),
    ["CVE-2026-0001", "CVE-2026-0003"],
  );
  const all = topVulnerabilities(report());
  assert.deepEqual(
    all.map((item) => item.vulnerabilityId),
    ["CVE-2026-0001", "CVE-2026-0003", "CVE-2026-0002"],
  );
});

test("describeScanOutcome covers success, partial, cancelled, and failure", () => {
  assert.equal(describeScanOutcome(undefined), undefined);
  const clean = describeScanOutcome(
    operation("succeeded"),
    report({
      vulnerabilities: [],
      totalVulnerabilities: 0,
      counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 },
    }),
  );
  assert.ok(clean);
  assert.equal(clean.tone, "success");
  assert.match(clean.title, /No vulnerabilities/);

  const found = describeScanOutcome(operation("succeeded"), report());
  assert.ok(found);
  assert.equal(found.tone, "error");
  assert.equal(found.title, "1 critical, 1 high, 1 low");

  const partial = describeScanOutcome(
    operation("succeeded"),
    report({ partial: true }),
  );
  assert.ok(partial);
  assert.equal(partial.tone, "info");
  assert.match(partial.title, /partial/);

  const cancelled = describeScanOutcome(operation("cancelled"));
  assert.ok(cancelled);
  assert.equal(cancelled.tone, "info");
  assert.match(cancelled.title, /cancelled/);

  const failed = describeScanOutcome(
    operation("failed", {
      error: {
        code: "scan_failed",
        message: "The scanner exited with code 2.",
        retryable: false,
        requestId: "req-1",
      },
    }),
  );
  assert.ok(failed);
  assert.equal(failed.tone, "error");
  assert.match(failed.body, /exited with code 2/);
});
