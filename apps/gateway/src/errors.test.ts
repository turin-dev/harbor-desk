import test from "node:test";
import assert from "node:assert/strict";

import { HttpError, problemFromError } from "./errors.js";

test("problemFromError maps an HttpError to its code, retryability, and details", () => {
  const error = new HttpError(
    409,
    "host_unavailable",
    "The Engine is offline.",
    {
      retryable: true,
      details: { endpoint: "npipe://docker" },
    },
  );
  assert.deepEqual(problemFromError(error, "req-1"), {
    code: "host_unavailable",
    message: "The Engine is offline.",
    retryable: true,
    requestId: "req-1",
    details: { endpoint: "npipe://docker" },
  });
});

test("problemFromError defaults retryable to false for HttpError", () => {
  const problem = problemFromError(
    new HttpError(403, "host_access_denied", "Denied."),
    "req-2",
  );
  assert.equal(problem.retryable, false);
  assert.equal(problem.code, "host_access_denied");
  assert.equal(problem.details, undefined);
});

test("problemFromError maps fastify validation errors to field-level details", () => {
  const problem = problemFromError(
    {
      validation: [
        { instancePath: "/body/name", message: "must be a string" },
        null,
        { unrelated: true },
      ],
    },
    "req-3",
  );
  assert.equal(problem.code, "validation_error");
  assert.equal(problem.retryable, false);
  assert.deepEqual(problem.details, [
    { field: "/body/name", message: "must be a string" },
    { message: "Invalid field." },
    { field: undefined, message: "Invalid field." },
  ]);
});

test("problemFromError falls back to internal_error for unknown failures", () => {
  assert.deepEqual(problemFromError(new Error("boom"), "req-4"), {
    code: "internal_error",
    message: "The gateway could not complete the request.",
    retryable: false,
    requestId: "req-4",
  });
  assert.equal(problemFromError("boom", "req-5").code, "internal_error");
});
