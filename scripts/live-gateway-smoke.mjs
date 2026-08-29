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
} catch (error) {
  check(
    "unexpected failure",
    false,
    error instanceof Error ? error.message : String(error),
  );
} finally {
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
process.exit(failed === 0 ? 0 : 1);
