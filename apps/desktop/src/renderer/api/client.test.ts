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
