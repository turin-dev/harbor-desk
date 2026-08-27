import test from "node:test";
import assert from "node:assert/strict";
import { MemoryEncryptedSecretStore } from "./secret-store.js";

test("encrypts and retrieves secrets by opaque reference", async () => {
  const store = new MemoryEncryptedSecretStore("test-master-key");
  const reference = await store.put("private-key-material");
  assert.match(reference, /^secret_/);
  assert.equal(await store.get(reference), "private-key-material");
  assert.equal(await store.get("secret_missing"), undefined);
});

test("deleting a secret makes it unrecoverable through the store", async () => {
  const store = new MemoryEncryptedSecretStore("test-master-key");
  const reference = await store.put("certificate");
  await store.delete(reference);
  assert.equal(await store.get(reference), undefined);
});
