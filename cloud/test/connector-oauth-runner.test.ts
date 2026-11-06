import assert from "node:assert/strict";
import test from "node:test";

// The production sandbox entrypoint is intentionally plain ESM, not compiled TypeScript.
// @ts-expect-error no declaration file is shipped into the runtime image
import * as oauthRunner from "../sandbox/oauth-runner.mjs";

const { createOAuthProvider, parseOAuthRequest } = oauthRunner;

const base = {
  operation: "begin",
  serverUrl: "https://mcp.example.test/rpc",
  redirectUrl: "https://cloud.example.test/api/mcp/oauth/callback",
  state: "33333333-3333-4333-8333-333333333333.random",
  allowInsecureLoopback: false,
};

test("OAuth runner rejects insecure remote URLs and embedded credentials", () => {
  assert.throws(() => parseOAuthRequest({ ...base, serverUrl: "http://mcp.example.test" }));
  assert.throws(() => parseOAuthRequest({ ...base, serverUrl: "https://user:secret@mcp.example.test" }));
  assert.throws(() => parseOAuthRequest({ ...base, redirectUrl: "https://evil.example.test/callback" }));
  assert.doesNotThrow(() => parseOAuthRequest({
    ...base,
    serverUrl: "http://127.0.0.1:3001/mcp",
    redirectUrl: "http://localhost:3000/api/mcp/oauth/callback",
    allowInsecureLoopback: true,
  }));
});

test("OAuth runner provider keeps secrets internal and begin never reuses an access token", async () => {
  const request = parseOAuthRequest({
    ...base,
    clientId: "registered",
    clientSecret: "client-secret",
    providerState: {
      tokens: { access_token: "old-token", refresh_token: "refresh" },
      codeVerifier: "old-verifier",
    },
  });
  const provider = createOAuthProvider(request);
  assert.deepEqual(await provider.clientInformation(), {
    client_id: "registered",
    client_secret: "client-secret",
  });
  assert.equal(await provider.tokens(), undefined);
  await provider.saveCodeVerifier("new-verifier");
  await provider.redirectToAuthorization(new URL(`https://login.example.test/auth?state=${encodeURIComponent(base.state)}`));
  const output = provider.result();
  assert.equal(output.state.codeVerifier, "new-verifier");
  assert.equal(output.state.tokens.access_token, "old-token");
  assert.match(output.authorizationUrl, /^https:\/\/login\.example\.test/);
});
