import test from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "./auth.js";
import type { GatewayConfig } from "@harbor/config";

const config: GatewayConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  gatewayVersion: "test",
  allowedOrigins: [],
  authMode: "oidc",
  engineEndpointAllowlist: [],
  oidcProviders: [
    {
      id: "example",
      displayName: "Example OIDC",
      issuer: "https://id.example.test",
      authorizationEndpoint: "https://id.example.test/oauth2/authorize",
      tokenEndpoint: "https://id.example.test/oauth2/token",
      audience: "harbor-desk",
      clientId: "harbor-client",
      scopes: ["openid", "profile"],
    },
  ],
};

test("builds a provider authorization URL with PKCE parameters", () => {
  const service = new AuthService(config);
  const url = new URL(
    service.authorizationUrl("example", {
      redirectUri: "harbor-desk://auth/callback",
      state: "state-1234567890123456",
      nonce: "nonce-1234567890123456",
      codeChallenge: "challenge-123456789012345678901234567890123456789",
    }),
  );

  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "harbor-client");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "harbor-desk://auth/callback",
  );
});

test("rejects non-desktop redirect URIs", () => {
  const service = new AuthService(config);
  assert.throws(
    () =>
      service.authorizationUrl("example", {
        redirectUri: "https://attacker.example/callback",
        state: "state-1234567890123456",
        nonce: "nonce-1234567890123456",
        codeChallenge: "challenge-123456789012345678901234567890123456789",
      }),
    /desktop callback/,
  );
});

test("limits non-admin users to the host IDs granted by their identity claims", () => {
  const service = new AuthService(config);
  const user = {
    id: "operator-1",
    displayName: "Operator",
    role: "operator" as const,
    hostIds: ["host-a"],
  };

  assert.deepEqual(service.permissions(user, ["host-a", "host-b"]).hostIds, [
    "host-a",
  ]);
  assert.deepEqual(
    service.permissions({ ...user, hostIds: undefined }, ["host-a", "host-b"])
      .hostIds,
    [],
  );
});
