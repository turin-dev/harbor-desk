import assert from "node:assert/strict";
import test from "node:test";
import { parseConnectionInput } from "../src/main/connection-input.js";

test("parses a complete connection target", () => {
  assert.deepEqual(
    parseConnectionInput({
      endpoint: "https://eng.example.com:2376",
      displayName: "Prod",
      ca: "ca",
      cert: "cert",
      key: "key",
    }),
    {
      endpoint: "https://eng.example.com:2376",
      displayName: "Prod",
      ca: "ca",
      cert: "cert",
      key: "key",
    },
  );
});

test("keeps only string fields and ignores extra or wrong-typed keys", () => {
  const parsed = parseConnectionInput({
    endpoint: "http://127.0.0.1:2375",
    displayName: 42,
    ca: null,
    note: "ignored",
  });
  assert.equal(parsed.endpoint, "http://127.0.0.1:2375");
  assert.equal(parsed.displayName, undefined);
  assert.equal(parsed.ca, undefined);
  assert.ok(!("note" in parsed));
});

test("rejects missing, non-object, and blank endpoints", () => {
  assert.throws(() => parseConnectionInput({}), /connection URL is required/i);
  assert.throws(
    () => parseConnectionInput({ endpoint: "   " }),
    /connection URL is required/i,
  );
  assert.throws(
    () => parseConnectionInput({ endpoint: 12345 }),
    /connection URL is required/i,
  );
  for (const value of [undefined, null, "http://x", 7]) {
    assert.throws(
      () => parseConnectionInput(value),
      /connection target is required/i,
    );
  }
  assert.throws(() => parseConnectionInput([]), /connection URL is required/i);
});
