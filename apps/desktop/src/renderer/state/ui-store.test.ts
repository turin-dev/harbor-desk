import assert from "node:assert/strict";
import test from "node:test";
import type { EventEnvelope } from "@harbor/contracts";

if (typeof globalThis.localStorage === "undefined") {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => memory.clear(),
      key: () => null,
      get length() {
        return memory.size;
      },
    },
    configurable: true,
  });
}
if (typeof globalThis.window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    configurable: true,
  });
}

const { useUiStore } = await import("./ui-store.js");

function makeEvent(
  cursor: string,
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  return {
    cursor,
    hostId: "h1",
    type: "container.stopped",
    resourceKind: "container",
    payload: {},
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

function resetStore(): void {
  useUiStore.setState({
    selectedHostId: undefined,
    terminalOpen: false,
    terminalContainerId: undefined,
    terminalContainerName: undefined,
    notifications: [],
    toast: undefined,
  });
}

test("addNotification dedupes by cursor, prepends, and caps at 50", () => {
  resetStore();
  const s = useUiStore.getState();
  s.addNotification(makeEvent("c1"));
  s.addNotification(makeEvent("c1"));
  s.addNotification(makeEvent("c2"));
  let notifications = useUiStore.getState().notifications;
  assert.equal(notifications.length, 2);
  assert.equal(notifications[0]!.id, "c2");
  assert.equal(notifications[1]!.id, "c1");
  assert.equal(notifications[0]!.read, false);

  for (let i = 0; i < 60; i++) {
    useUiStore.getState().addNotification(makeEvent("bulk-" + String(i)));
  }
  notifications = useUiStore.getState().notifications;
  assert.equal(notifications.length, 50);
  assert.equal(notifications[0]!.id, "bulk-59");
  assert.ok(!notifications.some((item) => item.id === "c2"));
});

test("markNotificationsRead flips every item and clearNotifications empties", () => {
  resetStore();
  const s = useUiStore.getState();
  s.addNotification(makeEvent("c1"));
  s.addNotification(makeEvent("c2"));
  useUiStore.getState().markNotificationsRead();
  assert.ok(
    useUiStore.getState().notifications.every((item) => item.read === true),
  );
  useUiStore.getState().clearNotifications();
  assert.deepEqual(useUiStore.getState().notifications, []);
});

test("showToast defaults to info severity and dismissToast clears it", () => {
  resetStore();
  useUiStore.getState().showToast("Saved");
  let toast = useUiStore.getState().toast;
  assert.equal(toast?.message, "Saved");
  assert.equal(toast?.severity, "info");
  useUiStore.getState().showToast("Prune failed", "error");
  toast = useUiStore.getState().toast;
  assert.equal(toast?.message, "Prune failed");
  assert.equal(toast?.severity, "error");
  useUiStore.getState().dismissToast();
  assert.equal(useUiStore.getState().toast, undefined);
});

test("switching hosts closes the terminal; same host keeps it open", () => {
  resetStore();
  const s = useUiStore.getState();
  s.setSelectedHostId("h1");
  s.setTerminalOpen(true);
  s.setTerminalContainer("c1", "app");
  assert.equal(useUiStore.getState().terminalOpen, true);

  useUiStore.getState().setSelectedHostId("h2");
  assert.equal(useUiStore.getState().terminalOpen, false);
  assert.equal(useUiStore.getState().terminalContainerId, undefined);

  useUiStore.getState().setSelectedHostId("h2");
  useUiStore.getState().setTerminalOpen(true);
  useUiStore.getState().setSelectedHostId("h2");
  assert.equal(useUiStore.getState().terminalOpen, true);
});

test("simple setters update state directly", () => {
  resetStore();
  const s = useUiStore.getState();
  s.setThemeMode("system");
  s.setLaunchAtLogin(true);
  s.setAutomaticUpdateChecks(false);
  s.setIncludePreviewUpdates(false);
  s.setShowConnectionNotifications(false);
  s.setTerminalFontSize(14);
  const next = useUiStore.getState();
  assert.equal(next.themeMode, "system");
  assert.equal(next.launchAtLogin, true);
  assert.equal(next.automaticUpdateChecks, false);
  assert.equal(next.includePreviewUpdates, false);
  assert.equal(next.showConnectionNotifications, false);
  assert.equal(next.terminalFontSize, 14);
  assert.equal(next.updateStatus.state, "idle");
  assert.ok(globalThis.localStorage.getItem("harbor-desk-ui"));
});
