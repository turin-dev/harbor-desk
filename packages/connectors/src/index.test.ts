import test from "node:test";
import assert from "node:assert/strict";
import { DockerEngineClient } from "./index.js";

test("accepts server-side HTTPS Engine endpoints and rejects unsupported protocols", () => {
  assert.doesNotThrow(
    () => new DockerEngineClient({ endpoint: "https://engine.internal:2376" }),
  );
  assert.throws(
    () => new DockerEngineClient({ endpoint: "ftp://engine.internal:21" }),
    /http, https, npipe, or unix/,
  );
});

test("supports the Windows development named pipe connector without exposing it as a client concern", () => {
  const client = new DockerEngineClient({
    endpoint: "npipe:////./pipe/dockerDesktopLinuxEngine",
  });
  assert.ok(client);
});

test("creates stable-looking event cursors for upstream events", () => {
  const event = {
    timeNano: 10_000,
    type: "container",
    Type: "container",
    action: "start",
  };
  const first = DockerEngineClient.eventCursor(event);
  const second = DockerEngineClient.eventCursor(event);
  assert.equal(first, second);
  assert.match(first, /^10000-[a-f0-9]{20}$/);
});
