import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.ts";
import { createStorage } from "../src/platform/storage.ts";

const ENV = {
  DATABASE_URL: "postgres://cloud:cloud@localhost:5432/cloud_test",
  PUBLIC_ORIGIN: "https://cloud.example.test",
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  SANDBOX_DOMAIN: "https://sandbox.example.test",
  SANDBOX_API_KEY: "sandbox-secret",
};

async function localStorage(root: string) {
  const storage = createStorage(loadConfig({ ...ENV, STORAGE_LOCAL_ROOT: root }));
  await storage.ready();
  return storage;
}

test("local storage atomically replaces, reads, and removes objects", async () => {
  const root = await mkdtemp(join(tmpdir(), "picoddy-cloud-storage-"));
  try {
    const storage = await localStorage(root);
    await storage.put("users/user-1/files/file-1", new TextEncoder().encode("first"), "text/plain");
    await storage.put("users/user-1/files/file-1", new TextEncoder().encode("second"), "text/plain");

    assert.equal(new TextDecoder().decode(await storage.get("users/user-1/files/file-1")), "second");
    await assert.rejects(storage.get("users/user-1/files/file-1", 5), /limit/i);
    assert.equal((await storage.get("users/user-1/files/file-1", 6)).byteLength, 6);
    assert.deepEqual(await readdir(join(root, "users/user-1/files")), ["file-1"]);

    await storage.remove("users/user-1/files/file-1");
    await assert.rejects(() => storage.get("users/user-1/files/file-1"), /ENOENT/);
    await storage.remove("users/user-1/files/file-1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local storage rejects traversal and non-canonical keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "picoddy-cloud-storage-"));
  try {
    const storage = await localStorage(root);
    for (const key of [
      "../escape", "/absolute", "users//file", "users/./file", "users\\file",
      "users/file.", "users/CON",
    ]) {
      await assert.rejects(
        () => storage.put(key, new Uint8Array([1]), "application/octet-stream"),
        /storage key/i,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local storage refuses symlinks below its root", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "picoddy-cloud-storage-"));
  const outside = await mkdtemp(join(tmpdir(), "picoddy-cloud-storage-outside-"));
  try {
    await mkdir(join(root, "users"));
    try {
      await symlink(outside, join(root, "users", "linked"), "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip("creating symlinks requires additional Windows privileges");
        return;
      }
      throw error;
    }
    await writeFile(join(outside, "secret"), "outside");
    const storage = await localStorage(root);

    await assert.rejects(
      () => storage.get("users/linked/secret"),
      /symbolic link/i,
    );
    await assert.rejects(
      () => storage.put("users/linked/new", new Uint8Array([1]), "application/octet-stream"),
      /symbolic link/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("local storage rejects a configured root that is itself a symlink", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "picoddy-cloud-storage-"));
  const actual = join(parent, "actual");
  const linked = join(parent, "linked");
  try {
    await mkdir(actual);
    try {
      await symlink(actual, linked, "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip("creating symlinks requires additional Windows privileges");
        return;
      }
      throw error;
    }
    const storage = createStorage(loadConfig({ ...ENV, STORAGE_LOCAL_ROOT: linked }));
    await assert.rejects(() => storage.ready(), /symbolic link/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
