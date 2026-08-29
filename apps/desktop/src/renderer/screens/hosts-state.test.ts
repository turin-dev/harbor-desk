import assert from "node:assert/strict";
import test from "node:test";
import { resolveHostsEmptyState } from "./hosts-state.js";

const gatewayStatus = {
  mode: "gateway" as const,
  endpoint: "https://gateway.example.test",
  gatewayUrl: "https://gateway.example.test",
  message: "Connected",
  localGateway: false,
};

test("does not report Gateway ready when the host query failed", () => {
  const state = resolveHostsEmptyState(gatewayStatus, true);

  assert.equal(state.title, "Could not load remote hosts");
  assert.equal(state.tone, "error");
  assert.deepEqual(state.action, {
    kind: "retry-hosts",
    label: "Retry host list",
  });
});

test("offers connection setup when no target is configured", () => {
  const state = resolveHostsEmptyState(
    {
      mode: "unconfigured",
      message: "No connection",
      localGateway: false,
    },
    false,
  );

  assert.equal(state.title, "Connect a Gateway or Docker Engine");
  assert.deepEqual(state.action, {
    kind: "configure",
    label: "Configure connection",
  });
});

test("shows the saved connection error when the target is unavailable", () => {
  const state = resolveHostsEmptyState(
    {
      mode: "unavailable",
      message: "The saved Gateway could not be reached.",
      localGateway: false,
    },
    false,
  );

  assert.equal(state.title, "Connection unavailable");
  assert.equal(state.description, "The saved Gateway could not be reached.");
  assert.deepEqual(state.action, {
    kind: "configure",
    label: "Change connection",
  });
});

test("keeps the empty host copy positive for a reachable Gateway", () => {
  const state = resolveHostsEmptyState(gatewayStatus, false);

  assert.equal(state.title, "Gateway ready · No Engine host connected");
  assert.equal(state.tone, "primary");
  assert.equal(state.action, undefined);
});
