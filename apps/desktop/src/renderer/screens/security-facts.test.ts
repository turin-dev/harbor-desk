import test from "node:test";
import assert from "node:assert/strict";
import type { Host, ImageSummary } from "@harbor/contracts";
import {
  connectionModeSummary,
  digestGate,
  digestSuffix,
  hostTrustFacts,
  isDigest,
  summarizeImageSecurity,
} from "./security-facts.js";

const host = (mode: Host["connectionMode"]): Host => ({
  id: "host-1",
  displayName: "build-box",
  status: "online",
  engineVersion: "27.4.0",
  apiVersion: "1.47",
  capabilities: {
    containers: true,
    images: true,
    volumes: true,
    networks: true,
    logs: true,
    stats: true,
    exec: true,
    compose: false,
    buildkit: true,
    kubernetes: false,
    extensions: false,
    imageScan: false,
    volumeFileBrowser: false,
  },
  connectionMode: mode,
});

const image: ImageSummary = {
  id: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  repository: "app",
  tag: "v1",
  createdAt: "2026-08-30T00:00:00Z",
  sizeBytes: 123,
  hostId: "host-1",
};

test("isDigest accepts well-formed sha256 digests only", () => {
  const good = "sha256:" + "a".repeat(64);
  assert.equal(isDigest(good), true);
  assert.equal(isDigest("sha256:" + "a".repeat(63)), false);
  assert.equal(isDigest("md5:" + "a".repeat(64)), false);
  assert.equal(isDigest(undefined), false);
});

test("digestSuffix shortens a digest for display", () => {
  const digest = "sha256:" + "b".repeat(64);
  assert.equal(digestSuffix(digest), "sha256:bbbbbbbbbbbb…");
  assert.equal(digestSuffix(undefined), undefined);
});

test("summarizeImageSecurity reports digest pinning from the row", () => {
  const digest = "sha256:" + "c".repeat(64);
  const facts = summarizeImageSecurity({ ...image, digest }, { data: {} });
  assert.equal(facts.digestPinned, true);
  assert.equal(facts.digest, digest);
  const gate = digestGate(facts);
  assert.equal(gate.pass.ok, true);
  assert.equal(gate.warn.ok, false);
});

test("summarizeImageSecurity derives facts from inspect data", () => {
  const digest = "sha256:" + "d".repeat(64);
  const facts = summarizeImageSecurity(image, {
    data: {
      RepoDigests: [digest],
      Config: { Os: "linux", Architecture: "amd64" },
      RootFS: {
        Layers: ["sha256:1", "sha256:2", "sha256:3"],
      },
    },
  });
  assert.equal(facts.digestPinned, true);
  assert.equal(facts.os, "linux");
  assert.equal(facts.arch, "amd64");
  assert.equal(facts.layerCount, 3);
  assert.equal(facts.inspectPending, false);
  assert.equal(facts.inspectUnavailable, false);
});

test("an unpinned image warns about reproducibility", () => {
  const facts = summarizeImageSecurity(image, { data: {} });
  assert.equal(facts.digestPinned, false);
  const gate = digestGate(facts);
  assert.equal(gate.pass.ok, false);
  assert.ok(gate.pass.message?.includes("digest"));
  assert.equal(gate.warn.ok, true);
});

test("hostTrustFacts flags development connections", () => {
  assert.equal(
    hostTrustFacts(host("development-http"))?.developmentConnection,
    true,
  );
  assert.equal(hostTrustFacts(host("mtls"))?.developmentConnection, false);
  assert.equal(hostTrustFacts(undefined), undefined);
  assert.equal(connectionModeSummary("mtls").label, "mTLS");
});
