import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChannelConnection, ChannelCredentials } from '../types.ts';

export interface SavedChannel {
  connection: ChannelConnection;
  credentials: ChannelCredentials;
  enabled: boolean;
}
export interface ChannelLocalData {
  version: 1;
  connections: SavedChannel[];
  sessions: Record<string, string>;
}
export interface ChannelDataStore {
  load(): Promise<ChannelLocalData>;
  save(data: ChannelLocalData): Promise<void>;
}
interface Encryption {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class ChannelLocalStore implements ChannelDataStore {
  constructor(private readonly path: string, private readonly encryption: Encryption) {}
  private check() {
    if (!this.encryption.isEncryptionAvailable() || this.encryption.getSelectedStorageBackend?.() === 'basic_text') throw new Error('系统安全存储不可用，无法保存远程通道凭证');
  }
  async load(): Promise<ChannelLocalData> {
    let bytes: Buffer;
    try { bytes = await readFile(this.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, connections: [], sessions: {} }; throw new Error('无法读取远程通道配置'); }
    this.check();
    try {
      const data = JSON.parse(this.encryption.decryptString(bytes));
      if (data.version !== 1 || !Array.isArray(data.connections) || !data.sessions || typeof data.sessions !== 'object' || Array.isArray(data.sessions)) throw new Error();
      for (const item of data.connections) {
        if (typeof item.connection?.id !== 'string' || typeof item.connection.channelId !== 'string' || typeof item.connection.name !== 'string' || !item.connection.config || typeof item.connection.config !== 'object' || !item.credentials || typeof item.credentials !== 'object' || typeof item.enabled !== 'boolean' || !Object.values(item.credentials).every(v => typeof v === 'string')) throw new Error();
        const knowledge = item.connection.knowledge;
        if (knowledge !== undefined && (!['directory', 'obsidian'].includes(knowledge?.kind) || typeof knowledge.directory !== 'string' || !knowledge.directory.trim())) throw new Error();
      }
      if (!Object.values(data.sessions).every(v => typeof v === 'string')) throw new Error();
      return data;
    } catch { throw new Error('无法读取远程通道配置，请检查系统钥匙串或配置文件'); }
  }
  async save(data: ChannelLocalData): Promise<void> {
    this.check(); const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await writeFile(temporary, this.encryption.encryptString(JSON.stringify(data)), { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.path);
    } catch { throw new Error('无法保存远程通道配置'); }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
}
