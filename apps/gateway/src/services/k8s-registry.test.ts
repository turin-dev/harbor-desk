import test from "node:test";
import assert from "node:assert/strict";
import type { GatewayConfig } from "@harbor/config";
import { HttpError } from "../errors.js";
import { K8sRegistry } from "./k8s-registry.js";
import type { SecretStore } from "./secret-store.js";
import { MemoryEncryptedSecretStore } from "./secret-store.js";

const baseConfig: GatewayConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 4310,
  gatewayVersion: "test",
  allowedOrigins: [],
  authMode: "dev",
  oidcProviders: [],
  engineEndpointAllowlist: [],
  secretMasterKey: "test-master-key",
};

function makeRegistry() {
  const inner = new MemoryEncryptedSecretStore(baseConfig.secretMasterKey);
  const refs: string[] = [];
  const secrets: SecretStore = {
    put: (value: string) =>
      inner.put(value).then((ref) => {
        refs.push(ref);
        return ref;
      }),
    get: (ref: string) => inner.get(ref),
    delete: (ref: string) => inner.delete(ref),
  };
  return {
    registry: new K8sRegistry({ config: baseConfig, secrets }),
    inner,
    refs,
  };
}

test("k8s registry: lists no clusters by default", () => {
  const { registry } = makeRegistry();
  assert.deepEqual(registry.list(), []);
});

test("k8s registry: registers an unreachable cluster as offline", async () => {
  const { registry } = makeRegistry();
  const cluster = await registry.add({
    displayName: "dev-cluster",
    endpoint: "http://127.0.0.1:9",
  });
  assert.equal(cluster.status, "offline");
  assert.equal(cluster.connectionMode, "development-http");
  assert.equal(registry.list().length, 1);
  const refreshed = await registry.test(cluster.id);
  assert.equal(refreshed.status, "offline");
});

test("k8s registry: maps unreachable namespace requests to 502", async () => {
  const { registry } = makeRegistry();
  const cluster = await registry.add({
    displayName: "dev-cluster",
    endpoint: "http://127.0.0.1:9",
  });
  await assert.rejects(registry.namespaces(cluster.id), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 502);
    assert.equal(error.code, "cluster_unavailable");
    return true;
  });
});

test("k8s registry: rejects invalid endpoints with 422", async () => {
  const { registry } = makeRegistry();
  await assert.rejects(
    registry.add({ displayName: "bad", endpoint: "not-a-url" }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 422);
      assert.equal(error.code, "invalid_cluster_endpoint");
      return true;
    },
  );
  await assert.rejects(
    registry.add({ displayName: "bad", endpoint: "ftp://example.com" }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.code, "invalid_cluster_endpoint");
      return true;
    },
  );
});

test("k8s registry: returns 404 for unknown clusters", async () => {
  const { registry } = makeRegistry();
  assert.throws(
    () => registry.get("missing"),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, "cluster_not_found");
      return true;
    },
  );
});

test("k8s registry: remove deletes the cluster and its stored secret", async () => {
  const { registry, inner, refs } = makeRegistry();
  const cluster = await registry.add({
    displayName: "secured",
    endpoint: "http://127.0.0.1:9",
    token: "kube-token-123",
  });
  assert.equal(refs.length, 1);
  const stored = await inner.get(refs[0]!);
  assert.ok(stored?.includes("kube-token-123"));
  await registry.remove(cluster.id);
  assert.deepEqual(registry.list(), []);
  assert.equal(await inner.get(refs[0]!), undefined);
});
