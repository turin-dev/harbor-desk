import assert from "node:assert/strict";
import test from "node:test";
import {
  connectionModeLabel,
  initials,
  statusBarPrimaryText,
  statusLabel,
  updateStatusLabel,
} from "./statusbar-copy.js";

test("maps host statuses to status bar labels", () => {
  assert.equal(statusLabel("online"), "Connected");
  assert.equal(statusLabel("offline"), "Offline");
  assert.equal(statusLabel("degraded"), "Degraded");
  assert.equal(statusLabel("unknown"), "Checking");
});

test("builds two-letter display initials with an HD fallback", () => {
  assert.equal(initials("Jaein Park"), "JP");
  assert.equal(initials("  jaemin  "), "J");
  assert.equal(initials("   "), "HD");
  assert.equal(initials(undefined), "HD");
  assert.equal(initials("a b c"), "AB");
});

test("labels connection modes and reports unavailable connections", () => {
  assert.equal(connectionModeLabel("gateway", false), "Server Gateway");
  assert.equal(connectionModeLabel("engine", false), "Local Gateway wrapper");
  assert.equal(connectionModeLabel("detecting", false), "Detecting connection");
  assert.equal(
    connectionModeLabel("unavailable", false),
    "Connection unavailable",
  );
  assert.equal(
    connectionModeLabel("unconfigured", true),
    "Connection unavailable",
  );
  assert.equal(connectionModeLabel(undefined, false), "Not configured");
  assert.equal(connectionModeLabel(undefined, true), "Connection unavailable");
});

test("labels update states and embeds the available version", () => {
  assert.equal(updateStatusLabel("checking"), "Checking for updates…");
  assert.equal(
    updateStatusLabel("available", "0.7.0"),
    "Update 0.7.0 available",
  );
  assert.equal(updateStatusLabel("up-to-date"), "Up to date");
  assert.equal(updateStatusLabel("error"), "Update check failed");
  assert.equal(updateStatusLabel("idle"), "Check for updates");
});

test("resolves the primary status text by precedence", () => {
  assert.equal(
    statusBarPrimaryText({
      connectionUnavailable: true,
      host: { displayName: "prod", status: "online" },
      connectionMode: "gateway",
    }),
    "Connection unavailable",
  );
  assert.equal(
    statusBarPrimaryText({
      connectionUnavailable: false,
      host: { displayName: "prod", status: "degraded" },
      connectionMode: "gateway",
    }),
    "prod · Degraded",
  );
  assert.equal(
    statusBarPrimaryText({
      connectionUnavailable: false,
      host: undefined,
      connectionMode: "engine",
    }),
    "Local Gateway ready · No Engine host",
  );
  assert.equal(
    statusBarPrimaryText({
      connectionUnavailable: false,
      host: undefined,
      connectionMode: "gateway",
    }),
    "Server Gateway ready · No host selected",
  );
  assert.equal(
    statusBarPrimaryText({
      connectionUnavailable: false,
      host: undefined,
      connectionMode: "unconfigured",
    }),
    "Configure a connection",
  );
});
