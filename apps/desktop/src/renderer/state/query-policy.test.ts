import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AUDIT_LIMIT,
  defaultAuditLimit,
  defaultDeleteForce,
  defaultPruneAll,
  isOperationFinalStatus,
  operationRefetchInterval,
  withDefaultOperationId,
} from "./query-policy.js";

test("treats only succeeded, failed, and cancelled operations as final", () => {
  assert.equal(isOperationFinalStatus("succeeded"), true);
  assert.equal(isOperationFinalStatus("failed"), true);
  assert.equal(isOperationFinalStatus("cancelled"), true);
  assert.equal(isOperationFinalStatus("running"), false);
  assert.equal(isOperationFinalStatus("pending"), false);
  assert.equal(isOperationFinalStatus(undefined), false);
});

test("stops operation polling once the status is final", () => {
  assert.equal(operationRefetchInterval("succeeded"), false);
  assert.equal(operationRefetchInterval("failed"), false);
  assert.equal(operationRefetchInterval("cancelled"), false);
  assert.equal(operationRefetchInterval("running"), 2000);
  assert.equal(operationRefetchInterval(undefined), 2000);
});

test("defaults the audit limit to 200 but keeps explicit values", () => {
  assert.equal(DEFAULT_AUDIT_LIMIT, 200);
  assert.equal(defaultAuditLimit(), 200);
  assert.equal(defaultAuditLimit(undefined), 200);
  assert.equal(defaultAuditLimit(50), 50);
  assert.equal(defaultAuditLimit(0), 0);
});

test("defaults optional booleans to false and keeps true", () => {
  assert.equal(defaultPruneAll(), false);
  assert.equal(defaultPruneAll(undefined), false);
  assert.equal(defaultPruneAll(true), true);
  assert.equal(defaultDeleteForce(), false);
  assert.equal(defaultDeleteForce(undefined), false);
  assert.equal(defaultDeleteForce(true), true);
});

test("reuses the caller operation id and only generates one when absent", () => {
  let calls = 0;
  const uuid = () => {
    calls += 1;
    return "uuid-" + calls;
  };
  assert.equal(withDefaultOperationId("op-1", uuid), "op-1");
  assert.equal(calls, 0);
  assert.equal(withDefaultOperationId(undefined, uuid), "uuid-1");
  assert.equal(calls, 1);
});
