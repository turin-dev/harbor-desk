import assert from "node:assert/strict";
import test from "node:test";
import { gateway, GatewayClientError } from "./client.js";

function installWindow(): () => void {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      harbor: {
        connection: {
          getStatus: async () => ({
            mode: "gateway",
            endpoint: "https://gateway.example.test",
            gatewayUrl: "https://gateway.example.test",
            message: "Connected",
            localGateway: false,
          }),
          getSessionToken: async () => undefined,
        },
        auth: {
          getAccessToken: async () => undefined,
          refresh: async () => false,
          logout: async () => true,
        },
      },
    },
  });

  return () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  };
}

test("normalizes Gateway timeouts without exposing transport details", async () => {
  const restoreWindow = installWindow();
  const previousFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (_input, init) => {
      assert.ok(init?.signal);
      throw new DOMException("timed out", "TimeoutError");
    };

    await assert.rejects(gateway.getHealth(), (error: unknown) => {
      return (
        error instanceof GatewayClientError &&
        error.code === "gateway_timeout" &&
        error.status === 0 &&
        error.retryable &&
        /timed out/i.test(error.message)
      );
    });
  } finally {
    globalThis.fetch = previousFetch;
    restoreWindow();
  }
});

test("normalizes transport failures as retryable Gateway errors", async () => {
  const restoreWindow = installWindow();
  const previousFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => {
      throw new Error("socket details must stay private");
    };

    await assert.rejects(gateway.getHealth(), (error: unknown) => {
      return (
        error instanceof GatewayClientError &&
        error.code === "gateway_unavailable" &&
        error.status === 0 &&
        error.retryable &&
        !error.message.includes("socket details")
      );
    });
  } finally {
    globalThis.fetch = previousFetch;
    restoreWindow();
  }
});

test("posts cancel requests to the operation cancel endpoint", async () => {
  const restoreWindow = installWindow();
  const previousFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (input, init) => {
      assert.ok(String(input).endsWith("/api/v1/operations/op-123/cancel"));
      assert.equal(init?.method, "POST");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: "op-123",
            kind: "image.pull",
            status: "cancelled",
            startedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      } as Response;
    };

    const operation = await gateway.cancelOperation("op-123");
    assert.equal(operation.id, "op-123");
    assert.equal(operation.status, "cancelled");
  } finally {
    globalThis.fetch = previousFetch;
    restoreWindow();
  }
});

test("sends the operation-id header for cancellable prune requests", async () => {
  const restoreWindow = installWindow();
  const previousFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (input, init) => {
      assert.ok(
        String(input).endsWith("/api/v1/hosts/host-1/prune/images?all=true"),
      );
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["operation-id"], "prune-op-1");
      assert.ok(headers["idempotency-key"]);
      return {
        ok: true,
        status: 202,
        json: async () => ({
          data: {
            id: "prune-op-1",
            kind: "prune.images",
            status: "running",
            startedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      } as Response;
    };

    const operation = await gateway.pruneResources(
      "host-1",
      "images",
      true,
      "prune-op-1",
    );
    assert.equal(operation.id, "prune-op-1");
    assert.equal(operation.status, "running");
  } finally {
    globalThis.fetch = previousFetch;
    restoreWindow();
  }
});

test("builds gateway stream WebSocket URLs from the active gateway", async () => {
  const restoreWindow = installWindow();
  try {
    assert.equal(
      await import("./client.js").then((m) => m.getGatewayWebSocketUrl()),
      "wss://gateway.example.test/api/v1/stream",
    );
    assert.equal(
      await import("./client.js").then((m) => m.getGatewayWebSocketUrl("h1")),
      "wss://gateway.example.test/api/v1/stream?hostId=h1",
    );
    assert.equal(
      await import("./client.js").then((m) =>
        m.getGatewayWebSocketUrl("h1", "1-abc", "tk"),
      ),
      "wss://gateway.example.test/api/v1/stream?hostId=h1&cursor=1-abc&ticket=tk",
    );
  } finally {
    restoreWindow();
  }
});

test("builds terminal WebSocket URLs with encoded session and ticket", async () => {
  const restoreWindow = installWindow();
  try {
    const { getTerminalWebSocketUrl } = await import("./client.js");
    assert.equal(
      await getTerminalWebSocketUrl("sess 1"),
      "wss://gateway.example.test/api/v1/terminal/sess%201",
    );
    assert.equal(
      await getTerminalWebSocketUrl("sess/1", "tk+1"),
      "wss://gateway.example.test/api/v1/terminal/sess%2F1?ticket=tk%2B1",
    );
  } finally {
    restoreWindow();
  }
});

test("lists volume files through the browse endpoint with an encoded path", async () => {
  const restoreWindow = installWindow();
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      assert.ok(
        String(input).endsWith(
          "/api/v1/hosts/host-1/volumes/vol%2F1/browse?path=%2Fsub",
        ),
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            volume: "vol/1",
            path: "/sub",
            entries: [
              {
                name: "b.txt",
                path: "/sub/b.txt",
                kind: "file",
                sizeBytes: 4,
              },
            ],
          },
        }),
      } as Response;
    };
    const result = await gateway.browseVolume("host-1", "vol/1", "/sub");
    assert.equal(result.volume, "vol/1");
    assert.equal(result.entries[0]?.name, "b.txt");
  } finally {
    globalThis.fetch = previousFetch;
    restoreWindow();
  }
});
