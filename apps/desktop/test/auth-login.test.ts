import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import {
  OIDC_REDIRECT_URI,
  buildAuthorizeUrl,
  deriveCodeChallenge,
  isValidProviderId,
  parseAuthCallback,
} from "../src/main/auth-login.js";

function material() {
  return {
    verifier: randomBytes(32).toString("base64url"),
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
  };
}

test("validates provider ids with the gateway identifier grammar", () => {
  assert.equal(isValidProviderId("google"), true);
  assert.equal(isValidProviderId("corp-idp_1.x-2"), true);
  assert.equal(isValidProviderId(""), false);
  assert.equal(isValidProviderId("a b"), false);
  assert.equal(isValidProviderId("idp#1"), false);
  assert.equal(isValidProviderId("idp".padEnd(129, "p")), false);
});

test("derives the PKCE code challenge with SHA-256 base64url", () => {
  const verifier = "dbjftd098733rjh6710";
  const expected = createHash("sha256").update(verifier).digest("base64url");
  assert.equal(deriveCodeChallenge(verifier), expected);
  assert.equal(expected.length > 0, true);
});

test("builds the authorize URL with redirect, state, nonce, and challenge", () => {
  const m = material();
  const url = new URL(
    buildAuthorizeUrl("https://gateway.example.test/", "google", m),
  );
  assert.equal(url.origin, "https://gateway.example.test");
  assert.equal(url.pathname, "/api/v1/auth/authorize/google");
  assert.equal(url.searchParams.get("redirectUri"), OIDC_REDIRECT_URI);
  assert.equal(url.searchParams.get("state"), m.state);
  assert.equal(url.searchParams.get("nonce"), m.nonce);
  assert.equal(
    url.searchParams.get("codeChallenge"),
    deriveCodeChallenge(m.verifier),
  );
});

test("percent-encodes special provider ids in the authorize path", () => {
  const m = material();
  const url = new URL(
    buildAuthorizeUrl("https://gateway.example.test", "my.idp/2", m),
  );
  assert.equal(url.pathname, "/api/v1/auth/authorize/my.idp%2F2");
});

test("accepts only the exact harbor-desk auth callback URL shape", () => {
  assert.equal(parseAuthCallback("not a url"), undefined);
  assert.equal(
    parseAuthCallback("https://auth.example.test/callback"),
    undefined,
  );
  assert.equal(
    parseAuthCallback("harbor-desk://other/callback?code=c&state=s"),
    undefined,
  );
  assert.equal(
    parseAuthCallback("harbor-desk://auth/other?code=c&state=s"),
    undefined,
  );
  assert.deepEqual(
    parseAuthCallback("harbor-desk://auth/callback?code=c1&state=s1"),
    {
      code: "c1",
      state: "s1",
    },
  );
  assert.deepEqual(parseAuthCallback("harbor-desk://auth/callback?state=s1"), {
    code: undefined,
    state: "s1",
  });
  assert.deepEqual(parseAuthCallback("harbor-desk://auth/callback"), {
    code: undefined,
    state: undefined,
  });
});
