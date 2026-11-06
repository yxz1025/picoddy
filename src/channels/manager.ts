import { ChannelRegistry } from './registry.ts';
import type { ChannelAdapter, ChannelConnection, ChannelCredentials, ChannelInboundMessage, ChannelOutboundMessage, ChannelStatus } from './types.ts';

interface Entry { adapter: ChannelAdapter; status: ChannelStatus; accepting: boolean }
export interface ChannelManagerHooks {
  /** Host applies group/user allowlists, deduplication, durable enqueueing and Agent routing here. */
  onMessage(message: ChannelInboundMessage): Promise<void>;
  onStatus?(status: ChannelStatus): void;
}

/** One runtime per connection ID. All lifecycle and send operations are serialized per connection. */
export class ChannelManager {
  private readonly entries = new Map<string, Entry>();
  private readonly operations = new Map<string, Promise<unknown>>();
  private disposed = false;
  constructor(private readonly registry: ChannelRegistry, private readonly hooks: ChannelManagerHooks) {}

  private serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    const next = (this.operations.get(id) ?? Promise.resolve()).catch(() => {}).then(action);
    this.operations.set(id, next);
    void next.finally(() => { if (this.operations.get(id) === next) this.operations.delete(id); }).catch(() => {});
    return next;
  }
  private publish(entry: Entry, status: ChannelStatus): void {
    entry.status = Object.freeze({ ...status });
    // Observer failures must not break transport lifecycle or mask connection errors.
    try { this.hooks.onStatus?.(entry.status); } catch {}
  }
  getStatus(id: string): ChannelStatus {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Unknown channel connection');
    return { ...entry.status };
  }
  listStatuses(): readonly ChannelStatus[] {
    return [...this.entries.values()].map(entry => ({ ...entry.status }));
  }
  connect(connection: ChannelConnection, credentials: ChannelCredentials): Promise<void> {
    return this.serial(connection.id, async () => {
      if (this.disposed) throw new Error('Channel manager is disposed');
      const previous = this.entries.get(connection.id);
      if (previous && previous.status.channelId !== connection.channelId) throw new Error('Connection channel cannot change');
      if (previous?.accepting) return;
      // A failed disconnect retains the runtime: never create a second live transport.
      if (previous && previous.status.state !== 'disconnected') await previous.adapter.disconnect();
      const factory = this.registry.get(connection.channelId);
      const snapshot = structuredClone(connection);
      let entry: Entry | undefined;
      try {
        const adapter = factory.create({
          connection: snapshot, credentials: { ...credentials },
          onMessage: async message => {
            if (!entry?.accepting || this.entries.get(connection.id) !== entry) throw new Error('Channel connection is inactive');
            await this.hooks.onMessage({ ...message, channelId: snapshot.channelId, connectionId: snapshot.id });
          },
          onStatus: state => {
            if (!entry?.accepting || this.entries.get(connection.id) !== entry) return;
            this.publish(entry, { connectionId: snapshot.id, channelId: snapshot.channelId, state,
              ...(state === 'error' ? { errorCode: 'TRANSPORT_FAILED' as const } : {}) });
          },
        });
        entry = { adapter, accepting: true, status: { connectionId: snapshot.id, channelId: snapshot.channelId, state: 'connecting' } };
        this.entries.set(snapshot.id, entry);
        this.publish(entry, entry.status);
        await adapter.connect();
        this.publish(entry, { connectionId: snapshot.id, channelId: snapshot.channelId, state: 'connected' });
      } catch {
        if (entry) {
          entry.accepting = false;
          let cleaned = false;
          try { await entry.adapter.disconnect(); cleaned = true; } catch {}
          this.publish(entry, { connectionId: snapshot.id, channelId: snapshot.channelId, state: 'error', errorCode: 'CONNECT_FAILED' });
          if (cleaned) {
            // Keep public failure status while making subsequent cleanup harmless.
            entry.adapter = { async connect() {}, async disconnect() {}, async send() { throw new Error('Channel is not connected'); } };
          }
        }
        throw new Error('Channel connection failed');
      }
    });
  }
  disconnect(id: string): Promise<void> {
    return this.serial(id, async () => {
      const entry = this.entries.get(id);
      if (!entry || entry.status.state === 'disconnected') return;
      entry.accepting = false;
      try {
        await entry.adapter.disconnect();
        this.publish(entry, { connectionId: id, channelId: entry.status.channelId, state: 'disconnected' });
      } catch {
        this.publish(entry, { connectionId: id, channelId: entry.status.channelId, state: 'error', errorCode: 'DISCONNECT_FAILED' });
        throw new Error('Channel disconnect failed');
      }
    });
  }
  send(id: string, message: ChannelOutboundMessage): Promise<void> {
    return this.serial(id, async () => {
      const entry = this.entries.get(id);
      if (!entry?.accepting || entry.status.state !== 'connected') throw new Error('Channel is not connected');
      try { await entry.adapter.send(message); } catch { throw new Error('Channel send failed'); }
    });
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    // Include queued connects that have not created an entry yet.
    const ids = new Set([...this.entries.keys(), ...this.operations.keys()]);
    const results = await Promise.allSettled([...ids].map(id => this.disconnect(id)));
    if (results.some(result => result.status === 'rejected')) throw new Error('Some channels failed to disconnect');
  }
}
