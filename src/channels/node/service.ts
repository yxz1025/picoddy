import { ChannelManager } from '../manager.ts';
import { ChannelRegistry } from '../registry.ts';
import { ChannelSessionRouter } from '../session-router.ts';
import type { ChannelAddress, ChannelAgentBridge, ChannelConnection, ChannelCredentials, ChannelInboundMessage } from '../types.ts';
import type { ChannelDataStore, ChannelLocalData } from './store.ts';

export class ChannelService {
  private data: ChannelLocalData = { version: 1, connections: [], sessions: {} };
  private readonly manager: ChannelManager;
  private readonly router: ChannelSessionRouter;
  private writes: Promise<void> = Promise.resolve();
  private changes: Promise<unknown> = Promise.resolve();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, Set<AbortController>>();
  private readonly blocked = new Set<string>();
  private pendingCount = 0;
  private closed = false;
  private readonly taskErrors = new Map<string, string>();
  constructor(
    private readonly registry: ChannelRegistry,
    private readonly store: ChannelDataStore,
    createSession: (address: ChannelAddress) => Promise<string>,
    private readonly bridge: ChannelAgentBridge,
  ) {
    this.router = new ChannelSessionRouter({
      get: async key => this.data.sessions[key],
      set: async (key, id) => { this.data.sessions[key] = id; await this.save(); },
    }, createSession);
    this.manager = new ChannelManager(registry, { onMessage: message => this.enqueue(message) });
  }
  private save(): Promise<void> {
    const operation = this.writes.catch(() => {}).then(() => this.store.save(structuredClone(this.data)));
    this.writes = operation; return operation;
  }
  private change<T>(fn: () => Promise<T>): Promise<T> {
    const operation = this.changes.catch(() => {}).then(fn);
    this.changes = operation; return operation;
  }
  async initialize(): Promise<void> {
    this.data = await this.store.load();
    for (const item of this.data.connections) {
      if (item.enabled) {
        try { await this.manager.connect(item.connection, item.credentials); }
        catch { this.taskErrors.set(item.connection.id, '自动连接失败，请检查凭证与网络后重试'); }
      }
    }
  }
  snapshot() {
    return { channels: this.registry.list(), connections: this.data.connections.map(item => {
      const status = this.manager.listStatuses().find(s => s.connectionId === item.connection.id);
      return { ...item.connection, enabled: item.enabled, configured: true,
        identity: this.registry.get(item.connection.channelId).publicIdentity?.(item.credentials) ?? {},
        status: status ?? { connectionId: item.connection.id, channelId: item.connection.channelId, state: 'disconnected' as const },
        lastError: this.taskErrors.get(item.connection.id),
      };
    }) };
  }
  configure(connection: ChannelConnection, credentialInput: ChannelCredentials): Promise<void> {
    return this.change(async () => {
      if (this.closed) throw new Error('远程通道已停止');
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(connection.id)) throw new Error('无效的连接 ID');
      const factory = this.registry.get(connection.channelId);
      const old = this.data.connections.find(item => item.connection.id === connection.id);
      const credentials = { ...credentialInput };
      const identity = factory.accountId?.(credentials);
      if (old && old.connection.channelId === connection.channelId && identity && identity === factory.accountId?.(old.credentials)) {
        for (const field of factory.descriptor.credentialFields) {
          if (field.type === 'password' && !credentials[field.key]?.trim()) credentials[field.key] = old.credentials[field.key];
        }
      }
      for (const field of factory.descriptor.credentialFields) {
        if (field.required && !credentials[field.key]?.trim()) throw new Error(`请填写${field.label}`);
      }
      const accountId = factory.accountId?.(credentials);
      if (accountId && this.data.connections.some(item => item.connection.id !== connection.id && item.connection.channelId === connection.channelId && factory.accountId?.(item.credentials) === accountId)) throw new Error('该账号已经配置在另一个连接中');
      if (old && old.connection.channelId !== connection.channelId) throw new Error('连接不能更换渠道类型');
      await this.stop(connection.id);
      const record = { connection: structuredClone(connection), credentials: { ...credentials }, enabled: true };
      this.data.connections = this.data.connections.filter(item => item.connection.id !== connection.id);
      this.data.connections.push(record);
      await this.save();
      this.blocked.delete(connection.id);
      this.taskErrors.delete(connection.id);
      try { await this.manager.connect(record.connection, record.credentials); }
      catch { this.taskErrors.set(connection.id, '连接失败，请检查凭证、渠道配置和网络'); throw new Error('通道连接失败，请检查凭证、渠道配置和网络'); }
    });
  }
  reconfigure(connection: ChannelConnection): Promise<void> {
    const item = this.data.connections.find(item => item.connection.id === connection.id && item.connection.channelId === connection.channelId);
    if (!item) return Promise.reject(new Error('请先扫码绑定微信'));
    return this.configure(connection, item.credentials);
  }
  reconnect(id: string): Promise<void> {
    const item = this.data.connections.find(item => item.connection.id === id);
    if (!item) return Promise.reject(new Error('请先配置机器人凭证'));
    return this.configure(item.connection, item.credentials);
  }
  disconnect(id: string): Promise<void> {
    return this.change(async () => {
      const item = this.data.connections.find(item => item.connection.id === id);
      if (item) item.enabled = false;
      // Failure to write the disabled flag must never prevent a user's explicit disconnect.
      try { await this.stop(id); }
      finally { if (item) await this.save(); }
    });
  }
  private async stop(id: string) {
    this.blocked.add(id);
    for (const controller of this.controllers.get(id) ?? []) controller.abort();
    await this.manager.disconnect(id);
  }
  private async enqueue(message: ChannelInboundMessage): Promise<void> {
    if (this.closed || this.blocked.has(message.connectionId)) throw new Error('通道已停止');
    const item = this.data.connections.find(item => item.connection.id === message.connectionId);
    if (!item?.enabled) throw new Error('通道已停用');
    const allows = (key: string, value: string) => {
      const text = item.connection.config[key];
      const list = typeof text === 'string' ? text.split(/[,，\n]/).map(v => v.trim()).filter(Boolean) : [];
      return !list.length || list.includes(value);
    };
    if (!allows('allowedConversationIds', message.conversationId) || !allows('allowedSenderIds', message.senderId)) return;
    if (this.pendingCount >= 100) throw new Error('远程通道队列已满');
    const knowledge = item.connection.knowledge;
    const scopeId = knowledge ? JSON.stringify([message.senderId, knowledge.kind, knowledge.directory]) : message.senderId;
    const key = JSON.stringify([message.channelId, message.connectionId, message.conversationId, scopeId]);
    const controller = new AbortController();
    const controllers = this.controllers.get(message.connectionId) ?? new Set();
    controllers.add(controller); this.controllers.set(message.connectionId, controllers);
    this.pendingCount++;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      if (controller.signal.aborted) return;
      try {
        const sessionId = await this.router.resolve({ channelId: message.channelId, connectionId: message.connectionId, conversationId: message.conversationId, scopeId });
        if (controller.signal.aborted) return;
        await this.bridge.handle({ sessionId, message, knowledge, signal: controller.signal, reply: async output => {
          if (!controller.signal.aborted) await this.manager.send(message.connectionId, { ...output, conversationId: message.conversationId, replyTo: message.id });
        } });
        this.taskErrors.delete(message.connectionId);
      } catch {
        if (!controller.signal.aborted) {
          this.taskErrors.set(message.connectionId, '任务执行或回复失败，可在客户端会话中查看详情');
          await this.manager.send(message.connectionId, { conversationId: message.conversationId, replyTo: message.id, text: '任务执行失败，请在电脑端检查模型配置和会话记录。' }).catch(() => {});
        }
      }
    }).finally(() => {
      this.pendingCount--; controllers.delete(controller);
      if (!controllers.size) this.controllers.delete(message.connectionId);
      if (this.queues.get(key) === run) this.queues.delete(key);
    });
    this.queues.set(key, run);
    // Background ownership: never leak rejected promises into the transport callback.
    void run.catch(() => {});
  }
  async idle(): Promise<void> { await Promise.all([...this.queues.values()]); await this.writes; }
  async dispose(): Promise<void> {
    this.closed = true;
    await this.changes.catch(() => {});
    for (const controllers of this.controllers.values()) for (const controller of controllers) controller.abort();
    await this.manager.dispose();
    await this.idle();
  }
}
