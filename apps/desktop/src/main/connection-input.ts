import type { ConnectionTargetInput } from "./connection-manager.js";

export function parseConnectionInput(value: unknown): ConnectionTargetInput {
  if (!value || typeof value !== "object")
    throw new Error("A connection target is required.");
  const input = value as Record<string, unknown>;
  const text = (key: string): string | undefined =>
    typeof input[key] === "string" ? input[key] : undefined;
  const endpoint = text("endpoint");
  if (!endpoint?.trim()) throw new Error("A connection URL is required.");
  return {
    endpoint,
    displayName: text("displayName"),
    ca: text("ca"),
    cert: text("cert"),
    key: text("key"),
  };
}
