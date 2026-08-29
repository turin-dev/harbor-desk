import assert from "node:assert/strict";
import test from "node:test";
import { loadGatewayConfig } from "./index.js";

test("allows local development renderer origins and the packaged origin by default", () => {
  assert.deepEqual(loadGatewayConfig({}).allowedOrigins, [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "null",
  ]);
});

test("does not allow the packaged origin by default in production", () => {
  assert.deepEqual(
    loadGatewayConfig({ NODE_ENV: "production" }).allowedOrigins,
    ["http://localhost:5173", "http://127.0.0.1:5173"],
  );
});

test("uses an explicit origin allowlist when configured", () => {
  assert.deepEqual(
    loadGatewayConfig({
      ALLOWED_ORIGINS: "https://desk.example.com, https://ops.example.com",
    }).allowedOrigins,
    ["https://desk.example.com", "https://ops.example.com"],
  );
});
