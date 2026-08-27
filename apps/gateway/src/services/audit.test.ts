import test from "node:test";
import assert from "node:assert/strict";
import { AuditStore } from "./audit.js";

test("stores bounded audit metadata without command contents", () => {
  const audit = new AuditStore();
  const event = audit.record({
    actorId: "user-1",
    hostId: "host-1",
    action: "container.delete",
    resourceKind: "container",
    resourceId: "container-1",
    result: "success",
    requestId: "request-1",
  });

  assert.equal(event.actorId, "user-1");
  assert.equal(audit.list(1)[0]?.action, "container.delete");
  assert.equal("command" in event, false);
});
