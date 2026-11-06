import type { ChannelAddress, ChannelSessionStore } from './types.ts';

/** Store keys use JSON tuples so delimiters in external IDs cannot collide. */
export class ChannelSessionRouter {
  private readonly pending = new Map<string, Promise<string>>();
  constructor(
    private readonly store: ChannelSessionStore,
    private readonly createSession: (address: ChannelAddress) => Promise<string>,
  ) {}
  resolve(address: ChannelAddress): Promise<string> {
    const snapshot = { ...address };
    const key = JSON.stringify([snapshot.channelId, snapshot.connectionId, snapshot.conversationId, snapshot.scopeId ?? null]);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const operation = (async () => {
      const saved = await this.store.get(key);
      if (saved) return saved;
      const id = await this.createSession(snapshot);
      await this.store.set(key, id);
      return id;
    })();
    this.pending.set(key, operation);
    void operation.finally(() => { this.pending.delete(key); }).catch(() => {});
    return operation;
  }
}
