import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveAuthGateView,
  shouldShowInitialGatewayLoading,
} from "./bootstrap-state.js";

test("keeps the application shell visible when the gateway cannot be reached", () => {
  assert.equal(
    resolveAuthGateView({
      hasUser: false,
      isPending: false,
      hasCompletedRequest: true,
      errorCode: undefined,
    }),
    "shell",
  );

  assert.equal(
    resolveAuthGateView({
      hasUser: false,
      isPending: false,
      hasCompletedRequest: true,
      errorCode: "http_error",
    }),
    "shell",
  );
});

test("shows login only after an explicit unauthorized gateway response", () => {
  assert.equal(
    resolveAuthGateView({
      hasUser: false,
      isPending: false,
      hasCompletedRequest: true,
      errorCode: "unauthorized",
    }),
    "login",
  );
});

test("waits for the initial session request before choosing a view", () => {
  assert.equal(
    resolveAuthGateView({
      hasUser: false,
      isPending: true,
      hasCompletedRequest: false,
      errorCode: undefined,
    }),
    "checking",
  );
});

test("keeps the shell mounted during a retry after the first session request", () => {
  assert.equal(
    resolveAuthGateView({
      hasUser: false,
      isPending: true,
      hasCompletedRequest: true,
      errorCode: undefined,
    }),
    "shell",
  );
});

test("does not hide the shell when a completed gateway query retries", () => {
  assert.equal(
    shouldShowInitialGatewayLoading({
      isLoading: true,
      hasCompletedRequest: true,
    }),
    false,
  );
  assert.equal(
    shouldShowInitialGatewayLoading({
      isLoading: true,
      hasCompletedRequest: false,
    }),
    true,
  );
});
