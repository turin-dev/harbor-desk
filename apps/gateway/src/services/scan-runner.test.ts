import test from "node:test";
import assert from "node:assert/strict";
import type { ImageScanReport } from "@harbor/contracts";
import { HttpError } from "../errors.js";
import {
  buildTrivyCommand,
  parseTrivyReport,
  ImageScanService,
  DEFAULT_SCANNER_IMAGE,
} from "./scan-runner.js";

const ctx = {
  image: "nginx:1.27",
  scannerImage: DEFAULT_SCANNER_IMAGE,
  startedAt: "2026-08-30T00:00:00.000Z",
  imageId: "sha256:abc123",
};

const trivyJson = JSON.stringify({
  SchemaVersion: 2,
  Results: [
    {
      Target: "nginx:1.27",
      Vulnerabilities: [
        {
          ID: "CVE-2026-0001",
          PkgName: "openssl",
          InstalledVersion: "3.0.9",
          FixedVersion: "3.0.13",
          Severity: "CRITICAL",
          Title: "openssl flaw",
        },
        {
          ID: "CVE-2026-0002",
          PkgName: "zlib",
          InstalledVersion: "1.2.13",
          FixedVersion: "",
          Severity: "high",
        },
        {
          ID: "CVE-2026-0003",
          PkgName: "musl",
          InstalledVersion: "1.2.4",
          Severity: "WEIRD",
        },
      ],
    },
  ],
});

test("buildTrivyCommand defaults to all severities", () => {
  assert.equal(
    buildTrivyCommand({ image: "nginx:1.27" }),
    "trivy image --quiet --format json --severity CRITICAL,HIGH,MEDIUM,LOW nginx:1.27",
  );
});

test("buildTrivyCommand normalizes custom severities", () => {
  assert.equal(
    buildTrivyCommand({ image: "nginx:1.27", severities: "CRITICAL, HIGH" }),
    "trivy image --quiet --format json --severity CRITICAL,HIGH nginx:1.27",
  );
  assert.equal(
    buildTrivyCommand({ image: "nginx:1.27", severities: "  critical high " }),
    "trivy image --quiet --format json --severity critical,high nginx:1.27",
  );
});

test("parseTrivyReport parses a clean Trivy report", () => {
  const report = parseTrivyReport(trivyJson, ctx);
  assert.equal(report.partial, false);
  assert.equal(report.totalVulnerabilities, 3);
  assert.deepEqual(report.counts, {
    CRITICAL: 1,
    HIGH: 1,
    MEDIUM: 0,
    LOW: 0,
    UNKNOWN: 1,
  });
  assert.equal(report.image, "nginx:1.27");
  assert.equal(report.imageId, "sha256:abc123");
  assert.equal(report.scannerImage, DEFAULT_SCANNER_IMAGE);
  assert.equal(report.startedAt, ctx.startedAt);
  assert.ok(report.finishedAt);
  assert.deepEqual(report.vulnerabilities[0], {
    vulnerabilityId: "CVE-2026-0001",
    package: "openssl",
    installedVersion: "3.0.9",
    fixedVersion: "3.0.13",
    severity: "CRITICAL",
    title: "openssl flaw",
    description: undefined,
  });
});

test("parseTrivyReport tolerates stderr noise around the JSON", () => {
  const noisy =
    "2026-08-30T00:00:01Z INFO [scanner] scanning\n" +
    "2026-08-30T00:00:02Z WARN image is not pinned by digest\n" +
    trivyJson +
    "\n2026-08-30T00:00:03Z INFO report finished\n";
  const report = parseTrivyReport(noisy, ctx);
  assert.equal(report.partial, false);
  assert.equal(report.totalVulnerabilities, 3);
});

test("parseTrivyReport marks the report partial when no JSON is found", () => {
  for (const raw of ["", "no json here at all", "{", "{ not json }"]) {
    const report = parseTrivyReport(raw, ctx);
    assert.equal(report.partial, true, raw);
    assert.equal(report.totalVulnerabilities, 0);
    assert.deepEqual(report.counts, {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      UNKNOWN: 0,
    });
  }
});

test("parseTrivyReport marks the report partial for an unrecognized shape", () => {
  const report = parseTrivyReport(JSON.stringify({ NotResults: true }), ctx);
  assert.equal(report.partial, true);
  assert.equal(report.totalVulnerabilities, 0);
});

test("parseTrivyReport handles an empty results array", () => {
  const report = parseTrivyReport(JSON.stringify({ Results: [] }), ctx);
  assert.equal(report.partial, false);
  assert.equal(report.totalVulnerabilities, 0);
});

interface FakeCalls {
  pullScanner: number;
  createContainer: Array<{
    name: string;
    command: string;
    labels?: Record<string, string>;
  }>;
  actions: Array<[string, string]>;
  deleted: Array<[string, boolean]>;
  progress: Array<[number, string]>;
}

function makeFakeRegistry(options: { exitCode?: number; logs?: string } = {}) {
  const calls: FakeCalls = {
    pullScanner: 0,
    createContainer: [],
    actions: [],
    deleted: [],
    progress: [],
  };
  const registry = {
    inspectImage: async () => {
      throw new HttpError(
        404,
        "resource_not_found",
        "The remote resource was not found.",
      );
    },
    pullImage: async (
      _hostId: string,
      _input: { image: string },
      onProgress?: (frame: { status: string; id?: string }) => void,
    ) => {
      calls.pullScanner += 1;
      onProgress?.({ status: "Waiting" });
      onProgress?.({ status: "Pull complete", id: "scanner" });
    },
    listImages: async () => [
      {
        id: "sha256:abc123",
        repository: "nginx",
        tag: "1.27",
        hostId: "host-1",
      },
    ],
    createContainer: async (
      _hostId: string,
      input: { name: string; command: string; labels?: Record<string, string> },
    ) => {
      calls.createContainer.push(input);
      return "ctr-scan-1";
    },
    containerAction: async (_hostId: string, id: string, action: string) => {
      calls.actions.push([id, action]);
    },
    inspectContainer: async () => ({
      State: { Status: "exited", ExitCode: options.exitCode ?? 0 },
    }),
    containerLogs: async () => options.logs ?? trivyJson,
    deleteContainer: async (_hostId: string, id: string, force: boolean) => {
      calls.deleted.push([id, force]);
    },
  };
  return { registry, calls };
}

test("run orchestrates a full scan and cleans up the scan container", async () => {
  const { registry, calls } = makeFakeRegistry();
  const service = new ImageScanService(registry as never);
  const progress: Array<[number, string]> = [];
  const report: ImageScanReport = await service.run({
    hostId: "host-1",
    input: { image: "nginx:1.27" },
    onProgress: (percent, message) => {
      progress.push([percent, message]);
    },
  });
  assert.equal(report.partial, false);
  assert.equal(report.totalVulnerabilities, 3);
  assert.equal(calls.pullScanner, 1);
  assert.equal(calls.createContainer.length, 1);
  const created = calls.createContainer[0];
  assert.ok(created, "expected a container create call");
  assert.ok(created.name.startsWith("harbor-scan-"));
  assert.equal(
    created.command,
    "trivy image --quiet --format json --severity CRITICAL,HIGH,MEDIUM,LOW nginx:1.27",
  );
  assert.deepEqual(created.labels, {
    "harbor.desk/scan": "image",
  });
  assert.deepEqual(calls.actions, [["ctr-scan-1", "start"]]);
  assert.deepEqual(calls.deleted, [["ctr-scan-1", true]]);
  assert.ok(progress.length >= 3);
  const first = progress[0];
  const last = progress[progress.length - 1];
  assert.ok(first && last, "expected progress updates");
  assert.equal(first[0], 5);
  assert.equal(last[0], 100);
  assert.ok(progress.some(([, message]) => message.includes("scanner image")));
});

test("run reports scan_failed when the scanner exits non-zero without a report", async () => {
  const { registry } = makeFakeRegistry({
    exitCode: 1,
    logs: "FATAL[0001] unexpected error",
  });
  const service = new ImageScanService(registry as never);
  await assert.rejects(
    () => service.run({ hostId: "host-1", input: { image: "nginx:1.27" } }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 502 &&
      error.code === "scan_failed",
  );
});

test("run returns a partial report when the scanner exits zero without JSON", async () => {
  const { registry } = makeFakeRegistry({ exitCode: 0, logs: "done" });
  const service = new ImageScanService(registry as never);
  const report = await service.run({
    hostId: "host-1",
    input: { image: "nginx:1.27" },
  });
  assert.equal(report.partial, true);
  assert.equal(report.totalVulnerabilities, 0);
});

test("run cancels cleanly and still deletes the scan container", async () => {
  const { registry, calls } = makeFakeRegistry();
  const controller = new AbortController();
  (registry as { inspectContainer: unknown }).inspectContainer = async () => {
    controller.abort();
    return { State: { Status: "running", ExitCode: 0 } };
  };
  const service = new ImageScanService(registry as never);
  await assert.rejects(
    () =>
      service.run({
        hostId: "host-1",
        input: { image: "nginx:1.27" },
        signal: controller.signal,
      }),
    (error: unknown) =>
      (error as { code?: string }).code === "operation_cancelled",
  );
  assert.deepEqual(calls.deleted, [["ctr-scan-1", true]]);
});
