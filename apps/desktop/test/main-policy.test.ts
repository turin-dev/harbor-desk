import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMainFrameCsp,
  connectionOriginsFor,
  harborCallbackUrl,
  secureTokenKey,
} from "../src/main/main-policy.js";

test("connectionOriginsFor derives http and ws origins", () => {
  assert.deepEqual(connectionOriginsFor("https://gateway.example.com:8443/"), [
    "https://gateway.example.com:8443",
    "wss://gateway.example.com:8443",
  ]);
  assert.deepEqual(connectionOriginsFor("http://127.0.0.1:8787"), [
    "http://127.0.0.1:8787",
    "ws://127.0.0.1:8787",
  ]);
});

test("connectionOriginsFor handles missing or invalid URLs", () => {
  assert.deepEqual(connectionOriginsFor(undefined), []);
  assert.deepEqual(connectionOriginsFor(""), []);
  assert.deepEqual(connectionOriginsFor("not a url"), []);
});

test("buildMainFrameCsp embeds every connect origin once", () => {
  const csp = buildMainFrameCsp([
    "http://127.0.0.1:5173",
    "ws://127.0.0.1:5173",
  ]);
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(
    csp.includes(
      "connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173",
    ),
  );
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.endsWith("font-src 'self' data:;"));
  assert.ok(!csp.includes("  "));
});

test("buildMainFrameCsp keeps self when no origins are provided", () => {
  const csp = buildMainFrameCsp([]);
  assert.ok(csp.includes("connect-src 'self'"));
});

test("secureTokenKey sanitizes path-unsafe characters", () => {
  assert.equal(secureTokenKey("connection-target"), "connection-target");
  assert.equal(secureTokenKey("access.token_1"), "access.token_1");
  assert.equal(secureTokenKey("a/b c:d e"), "a_b_c_d_e");
});

test("harborCallbackUrl picks the first callback argument", () => {
  assert.equal(harborCallbackUrl([]), undefined);
  assert.equal(
    harborCallbackUrl(["--flag", "harbor-desk://callback?code=abc"]),
    "harbor-desk://callback?code=abc",
  );
});
