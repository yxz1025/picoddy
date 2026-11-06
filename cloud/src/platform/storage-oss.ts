import OSS from 'ali-oss';
import type { Config } from '../config.ts';
import { bodyBytes, keySegments, type Storage } from './storage.ts';

/** The adapter never creates buckets, changes ACLs or exposes signed URLs. */
export function createOssStorage(config: Config, injectedClient?: Pick<OSS, 'put' | 'getStream' | 'delete' | 'getBucketInfo'>): Storage {
  if (!config.oss) throw new Error('OSS configuration is required');
  const options = config.oss;
  const client = injectedClient ?? new OSS({ ...options, secure: true, authorizationV4: true, timeout: 60_000 });
  return {
    async put(key, bytes, mime) {
      keySegments(key);
      await client.put(key, Buffer.from(bytes), { mime });
    },
    async get(key, maxBytes = config.maxUploadBytes) {
      keySegments(key);
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid storage read limit');
      const result = await client.getStream(key);
      try { return await bodyBytes(result.stream, maxBytes); }
      finally { result.stream?.destroy(); }
    },
    async remove(key) {
      keySegments(key);
      await client.delete(key);
    },
    async ready() { await client.getBucketInfo(options.bucket); },
  };
}
