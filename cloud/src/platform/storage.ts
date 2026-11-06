import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { Config } from "../config.ts";
import { createOssStorage } from './storage-oss.ts';

export interface Storage {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string, maxBytes?: number): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
  ready(): Promise<void>;
}

export async function bodyBytes(body: unknown, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid storage read limit');
  if (!body) throw new Error("Object storage returned an empty body");
  if (Symbol.asyncIterator in Object(body)) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > maxBytes) throw new Error('Object exceeds storage read limit');
      chunks.push(Buffer.from(bytes));
    }
    return new Uint8Array(Buffer.concat(chunks));
  }
  throw new Error("Object storage returned an unsupported body type");
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function keySegments(key: string): string[] {
  if (
    !key || Buffer.byteLength(key, "utf8") > 1024 || key.startsWith("/") ||
    key.endsWith("/") || key.includes("\\") || /[\u0000-\u001f\u007f]/.test(key)
  ) {
    throw new Error("Invalid storage key");
  }
  const segments = key.split("/");
  if (
    segments.some((segment) =>
      !segment || segment === "." || segment === ".." ||
      segment.endsWith(".") ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(segment)
    )
  ) {
    throw new Error("Invalid storage key");
  }
  return segments;
}

function assertWithin(root: string, candidate: string): void {
  const pathFromRoot = relative(root, candidate);
  if (
    pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error("Invalid storage key: path escapes local storage root");
  }
}

function createLocalStorage(config: Config): Storage {
  const configuredRoot = resolve(config.storageLocalRoot);
  let rootPromise: Promise<string> | undefined;

  const initialize = async (): Promise<string> => {
    try {
      await mkdir(configuredRoot, { recursive: true });
      const rootStat = await lstat(configuredRoot);
      if (rootStat.isSymbolicLink()) {
        throw new Error("Local storage root must not be a symbolic link");
      }
      if (!rootStat.isDirectory()) {
        throw new Error("Local storage root must be a directory");
      }
      const canonicalRoot = await realpath(configuredRoot);
      await access(canonicalRoot, constants.R_OK | constants.W_OK);
      return canonicalRoot;
    } catch (error) {
      rootPromise = undefined;
      throw error;
    }
  };

  const root = (): Promise<string> => {
    rootPromise ??= initialize();
    return rootPromise;
  };

  const filePath = async (key: string, createParents: boolean): Promise<string> => {
    const segments = keySegments(key);
    const canonicalRoot = await root();
    let current = canonicalRoot;
    for (const segment of segments.slice(0, -1)) {
      const next = join(current, segment);
      assertWithin(canonicalRoot, next);
      let pathStat: Awaited<ReturnType<typeof lstat>>;
      try {
        pathStat = await lstat(next);
      } catch (error) {
        if (!createParents || !isMissing(error)) throw error;
        try {
          await mkdir(next);
        } catch (mkdirError) {
          if (
            !(mkdirError instanceof Error && "code" in mkdirError && mkdirError.code === "EEXIST")
          ) {
            throw mkdirError;
          }
        }
        pathStat = await lstat(next);
      }
      if (pathStat.isSymbolicLink()) {
        throw new Error("Local storage path must not contain a symbolic link");
      }
      if (!pathStat.isDirectory()) {
        throw new Error("Local storage object parent must be a directory");
      }
      current = next;
    }
    const target = join(current, segments.at(-1)!);
    assertWithin(canonicalRoot, target);
    return target;
  };

  return {
    async put(key, bytes, _mime) {
      const target = await filePath(key, true);
      try {
        const targetStat = await lstat(target);
        if (targetStat.isSymbolicLink()) {
          throw new Error("Local storage object must not be a symbolic link");
        }
        if (!targetStat.isFile()) {
          throw new Error("Local storage object path must be a regular file");
        }
      } catch (error) {
        if (!isMissing(error)) throw error;
      }

      const temporary = join(dirname(target), `.upload-${randomUUID()}.tmp`);
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temporary, target);
      } catch (error) {
        await handle?.close().catch(() => undefined);
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    },
    async get(key, maxBytes = config.maxUploadBytes) {
      const target = await filePath(key, false);
      const targetStat = await lstat(target);
      if (targetStat.isSymbolicLink()) {
        throw new Error("Local storage object must not be a symbolic link");
      }
      if (!targetStat.isFile()) {
        throw new Error("Local storage object path must be a regular file");
      }
      const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
      const handle = await open(target, constants.O_RDONLY | noFollow);
      try {
        const openedStat = await handle.stat();
        if (!openedStat.isFile()) {
          throw new Error("Local storage object path must be a regular file");
        }
        if (openedStat.size > maxBytes) throw new Error('Object exceeds storage read limit');
        return await bodyBytes(handle.createReadStream({ autoClose: false }), maxBytes);
      } finally {
        await handle.close();
      }
    },
    async remove(key) {
      try {
        const target = await filePath(key, false);
        const targetStat = await lstat(target);
        if (targetStat.isSymbolicLink()) {
          throw new Error("Local storage object must not be a symbolic link");
        }
        if (!targetStat.isFile()) {
          throw new Error("Local storage object path must be a regular file");
        }
        await unlink(target);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
    async ready() {
      await root();
    },
  };
}

function createS3Storage(config: Config): Storage {
  const client = new S3Client({
    endpoint: config.storageEndpoint,
    region: config.storageRegion,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.storageAccessKey,
      secretAccessKey: config.storageSecretKey,
    },
  });

  return {
    async put(key, bytes, mime) {
      keySegments(key);
      await client.send(new PutObjectCommand({
        Bucket: config.storageBucket,
        Key: key,
        Body: bytes,
        ContentType: mime,
      }));
    },
    async get(key, maxBytes = config.maxUploadBytes) {
      keySegments(key);
      const response = await client.send(new GetObjectCommand({
        Bucket: config.storageBucket,
        Key: key,
      }));
      return bodyBytes(response.Body, maxBytes);
    },
    async remove(key) {
      keySegments(key);
      await client.send(new DeleteObjectCommand({
        Bucket: config.storageBucket,
        Key: key,
      }));
    },
    async ready() {
      await client.send(new HeadBucketCommand({ Bucket: config.storageBucket }));
    },
  };
}

export function createStorage(config: Config): Storage {
  if (config.storageDriver === 'oss') return createOssStorage(config);
  return config.storageDriver === "s3"
    ? createS3Storage(config)
    : createLocalStorage(config);
}
