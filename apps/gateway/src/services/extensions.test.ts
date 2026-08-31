import test from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "../errors.js";
import { ExtensionsService } from "./extensions.js";

function makeService() {
  return new ExtensionsService([
    {
      id: "harbor-insights",
      name: "Harbor Insights",
      version: "1.0.0",
      publisher: "Harbor Desk",
      description: "Summarizes cluster and host health.",
      category: "observability",
    },
    {
      id: "harbor-logstream",
      name: "Harbor Log Stream",
      version: "0.3.1",
      publisher: "Harbor Desk",
      description: "Streams container logs into the browser.",
      category: "observability",
    },
  ]);
}

test("extensions: lists the approved catalog as available", () => {
  const service = makeService();
  const items = service.list();
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.status, "available");
    assert.equal(item.approved, true);
    assert.ok(item.webUrl?.startsWith("/api/v1/extensions/"));
  }
});

test("extensions: install and uninstall flip the status", async () => {
  const service = makeService();
  const installed = await service.install("harbor-insights");
  assert.equal(installed.status, "installed");
  assert.equal(service.get("harbor-insights").status, "installed");
  const uninstalled = await service.uninstall("harbor-insights");
  assert.equal(uninstalled.status, "available");
});

test("extensions: unknown ids fail with 404 extension_not_found", async () => {
  const service = makeService();
  assert.throws(
    () => service.get("missing"),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, "extension_not_found");
      return true;
    },
  );
  await assert.rejects(service.install("missing"), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, "extension_not_found");
    return true;
  });
});
