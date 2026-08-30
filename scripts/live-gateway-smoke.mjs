#!/usr/bin/env node
// Full-stack live smoke: real gateway build + real Docker Engine.
//
// Boots the gateway in-process with dev auth, registers the live
// Engine as a host, pulls an image with a client-generated operation
// id, cancels the in-flight operation over HTTP, and asserts the
// gateway reports `cancelled` while the host stays online.
//
// Docker Desktop (Windows) by default; override the Engine with
// SMOKE_ENDPOINT (unix:///var/run/docker.sock or http://host:2375)
// and the pull target with SMOKE_IMAGE (default postgres:16, chosen
// Afterwards it exercises the host re-probe, capability matrix, and the
// container lifecycle actions (create, stop, start, delete) over HTTP.
// for a large image so the pull is reliably in-flight).

import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/gateway/dist/app.js";

const endpoint = process.env.SMOKE_ENDPOINT ?? "npipe:////./pipe/docker_engine";
const image = process.env.SMOKE_IMAGE ?? "postgres:16";

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(
    (ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  (" + detail + ")" : ""),
  );
}
function skip(name, detail) {
  results.push({ name, ok: true });
  console.log("SKIP  " + name + (detail ? "  (" + detail + ")" : ""));
}
async function pollOperation(app, operationId, attempts = 400) {
  let status = null;
  for (let i = 0; i < attempts && status === null; i += 1) {
    const polled = await app.inject({
      method: "GET",
      url: "/api/v1/operations/" + operationId,
    });
    if (polled.statusCode === 200) status = polled.json().data.status;
    else await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return status;
}

const config = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  gatewayVersion: "live-gateway-smoke",
  allowedOrigins: ["http://localhost:5173"],
  authMode: "dev",
  oidcProviders: [],
  engineEndpointAllowlist: [],
  secretMasterKey: "live-gateway-smoke-master-key",
};

const harbor = await buildApp(config);
let hostId = null;
try {
  const addRes = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts",
    payload: { displayName: "Live gateway smoke", endpoint },
  });
  check(
    "host registered",
    addRes.statusCode === 201 || addRes.statusCode === 200,
    "http=" + addRes.statusCode,
  );
  hostId = addRes.json().data.id;
  check(
    "host online after add",
    addRes.json().data.status === "online",
    addRes.json().data.status,
  );

  const operationId = randomUUID();
  const pull = harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + hostId + "/images/pull",
    headers: { "operation-id": operationId },
    payload: { image },
  });

  let status = null;
  let polls = 0;
  for (let i = 0; i < 80 && status === null; i += 1) {
    polls += 1;
    const polled = await harbor.app.inject({
      method: "GET",
      url: "/api/v1/operations/" + operationId,
    });
    if (polled.statusCode === 200) status = polled.json().data.status;
    else await new Promise((resolve) => setTimeout(resolve, 60));
  }
  check(
    "operation visible by client-generated id",
    status !== null,
    "polls=" + polls + (status ? ", status=" + status : ", not found"),
  );

  if (status === "running" || status === "queued") {
    const cancel = await harbor.app.inject({
      method: "POST",
      url: "/api/v1/operations/" + operationId + "/cancel",
    });
    const cancelBody = cancel.json().data;
    check(
      "cancel endpoint reports cancelled",
      cancel.statusCode === 200 && cancelBody.status === "cancelled",
      "http=" + cancel.statusCode + ", op=" + cancelBody.status,
    );
    const pullResponse = await pull;
    check(
      "pull settles 202 with the cancelled operation",
      pullResponse.statusCode === 202 &&
        pullResponse.json().data.status === "cancelled",
      "http=" +
        pullResponse.statusCode +
        ", op=" +
        pullResponse.json().data.status,
    );
  } else {
    const pullResponse = await pull;
    skip(
      "cancel path",
      "pull settled " +
        (status ?? "before first poll") +
        " before the cancel ran (cached image?); http=" +
        pullResponse.statusCode,
    );
  }

  const seedPull = randomUUID();
  const seed = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + hostId + "/images/pull",
    headers: { "operation-id": seedPull },
    payload: { image: "alpine:3.20" },
  });
  const seedStatus = await pollOperation(harbor.app, seedPull);
  check(
    "small image available for the container lifecycle (pulled if needed)",
    seed.statusCode === 202 && seedStatus === "succeeded",
    "http=" + seed.statusCode + ", op=" + seedStatus,
  );

  const testRes = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + hostId + "/test",
  });
  check(
    "host re-probe (test) reports the Engine online",
    testRes.statusCode === 200 && testRes.json().data.status === "online",
    "http=" + testRes.statusCode,
  );

  const caps = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hosts/" + hostId + "/capabilities",
  });
  check(
    "capability matrix reports container support",
    caps.statusCode === 200 && caps.json().data?.containers === true,
    "http=" + caps.statusCode,
  );

  const containerName = "harbor-live-smoke-" + randomUUID().slice(0, 8);
  const create = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + hostId + "/containers",
    payload: { image: "alpine:3.20", name: containerName, command: "sleep 30" },
  });
  check(
    "container create+start settles as a succeeded operation",
    create.statusCode === 202 && create.json().data.status === "succeeded",
    "http=" + create.statusCode + ", op=" + create.json().data?.status,
  );

  let created = null;
  for (let i = 0; i < 40 && !created; i += 1) {
    const list = await harbor.app.inject({
      method: "GET",
      url: "/api/v1/hosts/" + hostId + "/containers",
    });
    created = (list.json().data ?? []).find(
      (row) => row.name === containerName,
    );
    if (!created) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check("created container is listed", created !== null, containerName);

  const stopOp = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + hostId + "/containers/" + created.id + "/stop",
  });
  check(
    "stop action returns a succeeded operation",
    stopOp.statusCode === 202 && stopOp.json().data.status === "succeeded",
    "op=" + stopOp.json().data?.status,
  );

  const startOp = await harbor.app.inject({
    method: "POST",
    url: "/api/v1/hosts/" + hostId + "/containers/" + created.id + "/start",
  });
  check(
    "start action returns a succeeded operation",
    startOp.statusCode === 202 && startOp.json().data.status === "succeeded",
    "op=" + startOp.json().data?.status,
  );

  const delOp = await harbor.app.inject({
    method: "DELETE",
    url:
      "/api/v1/hosts/" + hostId + "/containers/" + created.id + "?force=true",
  });
  check(
    "container delete returns a succeeded operation",
    delOp.statusCode === 202 && delOp.json().data.status === "succeeded",
    "op=" + delOp.json().data?.status,
  );

  const listAfter = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hosts/" + hostId + "/containers",
  });
  check(
    "deleted container is gone from the list",
    !(listAfter.json().data ?? []).some((row) => row.name === containerName),
    containerName,
  );

  const hosts = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hosts",
  });
  const row = hosts.json().data.find((item) => item.id === hostId);
  check(
    "host still online after in-flight cancel",
    row?.status === "online",
    row?.status ?? "host missing",
  );

  const hub = await harbor.app.inject({
    method: "GET",
    url: "/api/v1/hub/search?q=nginx&limit=5",
  });
  check(
    "live hub search returns 200",
    hub.statusCode === 200,
    "http=" +
      hub.statusCode +
      (hub.statusCode === 200
        ? ""
        : " " + hub.rawPayload.toString().slice(0, 160)),
  );
  if (hub.statusCode === 200) {
    const body = hub.json().data;
    check(
      "live hub search results are normalized",
      Array.isArray(body?.results) &&
        body.results.length > 0 &&
        typeof body.results[0]?.repository === "string" &&
        typeof body.resultCount === "number",
      (body?.resultCount ?? 0) + " total matches",
    );
    const audit = await harbor.app.inject({
      method: "GET",
      url: "/api/v1/audit?limit=5",
    });
    check(
      "live hub search is audited",
      (audit.json().data ?? []).some(
        (event) =>
          event.action === "hub.search" && event.resourceId === "nginx",
      ),
    );
  }
  {
    // Real Trivy scan of an already-pulled image on the live Engine.
    // The scanner image (aquasec/trivy:0.58.2) is pulled by the service
    // on first use, so the first run is dominated by the scanner pull.
    const scanOpId = randomUUID();
    const scanStart = Date.now();
    const scanPost = await harbor.app.inject({
      method: "POST",
      url: "/api/v1/hosts/" + hostId + "/images/scan",
      headers: { "operation-id": scanOpId },
      payload: { image: "alpine:3.20", severities: "CRITICAL,HIGH" },
    });
    check(
      "image scan settles 202",
      scanPost.statusCode === 202,
      "http=" + scanPost.statusCode,
    );
    const scanOp = scanPost.json().data;
    const scanDurationMs = Date.now() - scanStart;
    check(
      "image scan settles as a succeeded operation",
      scanOp?.status === "succeeded",
      "op=" +
        (scanOp?.status ?? "unknown") +
        ", " +
        (scanDurationMs / 1000).toFixed(1) +
        "s" +
        (scanOp?.error ? ", error=" + scanOp.error.message : ""),
    );
    if (scanOp?.status === "succeeded") {
      const report = await harbor.app.inject({
        method: "GET",
        url: "/api/v1/hosts/" + hostId + "/images/scans/" + scanOpId,
      });
      const data = report.json().data;
      check(
        "scan report is fetchable and parsed (not partial)",
        report.statusCode === 200 &&
          data.partial === false &&
          typeof data.totalVulnerabilities === "number" &&
          data.image === "alpine:3.20",
        "http=" +
          report.statusCode +
          ", partial=" +
          (data?.partial ?? "?") +
          ", vulns=" +
          (data?.totalVulnerabilities ?? "?"),
      );
      const unknownAfter = await harbor.app.inject({
        method: "GET",
        url: "/api/v1/hosts/" + hostId + "/images/scans/nope-" + scanOpId,
      });
      check(
        "unknown scan operation returns 404 scan_report_not_found",
        unknownAfter.statusCode === 404 &&
          unknownAfter.json().error.code === "scan_report_not_found",
        "http=" + unknownAfter.statusCode,
      );
      const containersAfter = await harbor.app.inject({
        method: "GET",
        url: "/api/v1/hosts/" + hostId + "/containers",
      });
      check(
        "scan container is removed after the scan",
        !(containersAfter.json().data ?? []).some((row) =>
          String(row.name).startsWith("harbor-scan-"),
        ),
        (containersAfter.json().data ?? []).length + " containers listed",
      );
      const scanAudit = await harbor.app.inject({
        method: "GET",
        url: "/api/v1/audit?limit=10",
      });
      check(
        "image scan is audited",
        (scanAudit.json().data ?? []).some(
          (event) =>
            event.action === "image.scan" && event.resourceId === "alpine:3.20",
        ),
      );
    } else {
      skip(
        "live scan report assertions",
        "scan settled " +
          (scanOp?.status ?? "unknown") +
          " (see previous check)",
      );
    }
  }
} catch (error) {
  check(
    "unexpected failure",
    false,
    error instanceof Error ? error.message : String(error),
  );
} finally {
  // The Engine npipe /events socket is torn down by the gateway on
  // host removal and app close, so no live Engine connection is left
  // behind at teardown.
  if (hostId) {
    await harbor.app
      .inject({ method: "DELETE", url: "/api/v1/hosts/" + hostId })
      .catch(() => undefined);
  }
  await harbor.app.close();
}

const failed = results.filter((item) => !item.ok).length;
console.log("");
console.log(
  failed === 0
    ? "LIVE GATEWAY SMOKE PASS (" + results.length + " checks)"
    : "LIVE GATEWAY SMOKE FAIL (" +
        failed +
        " of " +
        results.length +
        " checks)",
);
// Known libuv/Node Windows teardown quirk (libuv#3622): calling
// process.exit() while npipe/undici handles are still settling can trip
// the UV_HANDLE_CLOSING assertion. Let the loop drain naturally instead,
// with an unref'd watchdog so a lingering handle cannot hang the smoke.
process.exitCode = failed === 0 ? 0 : 1;
setTimeout(() => process.exit(process.exitCode), 10_000).unref();
