import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken, hashSessionToken } from "../src/cloud/auth/service.ts";
import { loadConfig } from "../src/config.ts";
import { seal, unseal } from "../src/infra/crypto.ts";

const ENV = {
  DATABASE_URL: "postgres://cloud:cloud@localhost:5432/cloud_test",
  PUBLIC_ORIGIN: "https://cloud.example.test",
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  SANDBOX_DOMAIN: "https://sandbox.example.test",
  SANDBOX_API_KEY: "sandbox-secret",
};

test("loadConfig defaults to local storage and returns typed values", () => {
  const config = loadConfig({
    ...ENV,
    PUBLIC_ORIGIN: "http://localhost:8080",
    PORT: "9090",
    SECURE_COOKIES: "false",
    MAX_UPLOAD_BYTES: "4096",
    WORKER_CONCURRENCY: "3",
    MODEL_ALLOWED_HOSTS: "models.example.test, api.openai.com",
  });

  assert.equal(config.port, 9090);
  assert.equal(config.secureCookies, false);
  assert.equal(config.maxUploadBytes, 4096);
  assert.equal(config.workerConcurrency, 3);
  assert.equal(config.storageDriver, "local");
  assert.match(config.storageLocalRoot, /cloud[/\\]data[/\\]files$/);
  assert.equal(config.storageEndpoint, "");
  assert.equal(config.storageAccessKey, "");
  assert.equal(config.storageSecretKey, "");
  assert.deepEqual(config.modelAllowedHosts, ["models.example.test", "api.openai.com"]);
});

test("loadConfig requires object-storage credentials only for the s3 driver", () => {
  assert.throws(
    () => loadConfig({ ...ENV, STORAGE_DRIVER: "s3" }),
    /STORAGE_ENDPOINT/,
  );

  const config = loadConfig({
    ...ENV,
    STORAGE_DRIVER: "s3",
    STORAGE_ENDPOINT: "https://storage.example.test",
    STORAGE_ACCESS_KEY: "access-key",
    STORAGE_SECRET_KEY: "storage-secret",
  });
  assert.equal(config.storageDriver, "s3");
  assert.equal(config.storageEndpoint, "https://storage.example.test");
  assert.equal(config.storageAccessKey, "access-key");
});

test("loadConfig resolves relative local roots from cloud rather than cwd", () => {
  const config = loadConfig({ ...ENV, STORAGE_LOCAL_ROOT: "var/files" });
  assert.match(config.storageLocalRoot, /cloud[/\\]var[/\\]files$/);
});

test("loadConfig rejects absent deployment secrets", () => {
  assert.throws(
    () => loadConfig({ ...ENV, ENCRYPTION_KEY: "" }),
    /ENCRYPTION_KEY/,
  );
});

test("AES-GCM seals structured secrets without exposing plaintext", () => {
  const value = { apiKey: "never-print-me", nested: [1, true] };
  const ciphertext = seal(value, ENV.ENCRYPTION_KEY);

  assert.doesNotMatch(ciphertext, /never-print-me/);
  assert.deepEqual(unseal(ciphertext, ENV.ENCRYPTION_KEY), value);
  assert.throws(
    () => unseal(ciphertext, "abcdef0123456789abcdef0123456789"),
    /decrypt/i,
  );
});

test("session tokens are opaque and only their stable digest is stored", () => {
  const token = createSessionToken();
  const second = createSessionToken();

  assert.notEqual(token, second);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(hashSessionToken(token), /^[a-f0-9]{64}$/);
  assert.equal(hashSessionToken(token), hashSessionToken(token));
  assert.notEqual(hashSessionToken(token), hashSessionToken(second));
});
