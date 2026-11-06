import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';

export interface DingTalkFrame { headers: { messageId: string }; data: string }
export interface DingTalkTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listen(handler: (frame: DingTalkFrame) => Promise<void>): void;
  ack(messageId: string): void;
}
export interface StreamClient {
  config: { autoReconnect?: boolean };
  connected: boolean;
  getEndpoint(): Promise<unknown>;
  _connect(): Promise<void>;
  disconnect(): void;
  registerCallbackListener(topic: string, callback: (frame: DingTalkFrame) => void): unknown;
  socketCallBackResponse(id: string, result: unknown): void;
}
interface TransportOptions {
  createClient?: () => StreamClient;
  monitorIntervalMs?: number;
}

/** SDK 2.1.5 connect() swallows failures and leaves retry timers. Own the retry loop instead. */
export function createDingTalkTransport(
  clientId: string, clientSecret: string,
  status: (state: 'connected' | 'reconnecting' | 'error') => void,
  options: TransportOptions = {},
): DingTalkTransport {
  let current: StreamClient | undefined;
  let handler: ((frame: DingTalkFrame) => Promise<void>) | undefined;
  let stopped = true;
  let monitor: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  async function bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('钉钉连接超时')), 15_000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  function closeCurrent() { const old = current; current = undefined; old?.disconnect(); }
  async function open(epoch: number) {
    // SDK socket close handlers mutate instance.connected: never reuse an instance across attempts.
    const client = options.createClient?.() ?? new DWClient({ clientId, clientSecret, debug: false, keepAlive: true });
    client.config.autoReconnect = false;
    current = client;
    client.registerCallbackListener(TOPIC_ROBOT, frame => {
      if (current !== client || stopped) return;
      void handler?.(frame).catch(() => { /* No ACK: platform may redeliver. Never log raw frame. */ });
    });
    try {
      await bounded(client.getEndpoint());
      if (stopped || epoch !== generation) throw new Error('连接已取消');
      await bounded(client._connect());
      if (stopped || epoch !== generation) throw new Error('连接已取消');
    } catch (error) {
      if (current === client) current = undefined;
      client.disconnect();
      throw error;
    }
  }
  function schedule(epoch: number) {
    if (stopped || epoch !== generation) return;
    monitor = setTimeout(async () => {
      try {
        if (!current?.connected) {
          status('reconnecting'); closeCurrent();
          await open(epoch); status('connected');
        }
      } catch { if (!stopped && epoch === generation) status('reconnecting'); }
      finally { schedule(epoch); }
    }, options.monitorIntervalMs ?? 5_000);
    monitor.unref?.();
  }
  return {
    listen(callback) { handler = callback; },
    ack(id) { current?.socketCallBackResponse(id, { errcode: 0, errmsg: 'ok' }); },
    async connect() {
      stopped = false; const epoch = ++generation;
      try { await open(epoch); schedule(epoch); }
      catch { stopped = true; closeCurrent(); throw new Error('钉钉连接失败，请检查凭证、机器人发布状态和网络'); }
    },
    async disconnect() {
      stopped = true; generation++;
      if (monitor) clearTimeout(monitor);
      closeCurrent();
    },
  };
}
