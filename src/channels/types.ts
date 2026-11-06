/** Platform-neutral contracts. Never include credentials in public connection/status objects. */
export type ChannelConfig = Readonly<Record<string, unknown>>;
export type ChannelCredentials = Readonly<Record<string, string>>;
export interface ChannelField {
  readonly key: string;
  readonly label: string;
  readonly type: 'text' | 'password' | 'boolean' | 'number';
  readonly required?: boolean;
  readonly placeholder?: string;
}
export interface ChannelDescriptor {
  readonly id: string;
  readonly name: string;
  readonly configFields: readonly ChannelField[];
  readonly credentialFields: readonly ChannelField[];
  readonly capabilities: { readonly attachments: boolean; readonly streaming: boolean };
}
export interface ChannelKnowledgeBinding {
  readonly kind: 'directory' | 'obsidian';
  readonly directory: string;
}
export interface ChannelConnection {
  readonly id: string;
  readonly channelId: string;
  readonly name: string;
  readonly config: ChannelConfig;
  readonly knowledge?: ChannelKnowledgeBinding;
}
export interface ChannelAddress {
  channelId: string;
  connectionId: string;
  conversationId: string;
  /** Optional per-user or thread isolation within the external conversation. */
  scopeId?: string;
}
export interface ChannelAttachment {
  name: string;
  mimeType?: string;
  /** Opaque platform reference, resolved by the adapter; never a local executable path. */
  reference: string;
}
export interface ChannelMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  timestamp: number;
  threadId?: string;
  attachments?: readonly ChannelAttachment[];
}
export interface ChannelInboundMessage extends ChannelMessage {
  channelId: string;
  connectionId: string;
}
export interface ChannelOutboundMessage {
  conversationId: string;
  text: string;
  replyTo?: string;
  threadId?: string;
  format?: 'text' | 'markdown';
  attachments?: readonly ChannelAttachment[];
}
export type ChannelState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
export interface ChannelStatus {
  readonly connectionId: string;
  readonly channelId: string;
  readonly state: ChannelState;
  /** Public error code only; raw SDK errors can contain credentials. */
  readonly errorCode?: 'CONNECT_FAILED' | 'DISCONNECT_FAILED' | 'TRANSPORT_FAILED';
}
export interface ChannelAdapterContext {
  readonly connection: ChannelConnection;
  readonly credentials: ChannelCredentials;
  /** Resolve only when accepted by the host. Adapter owns ACK/retry and message deduplication. */
  onMessage(message: ChannelMessage): Promise<void>;
  /** Adapter owns automatic reconnection; manager does not start a second retry loop. */
  onStatus(state: 'connected' | 'reconnecting' | 'error'): void;
}
export interface ChannelAdapter {
  connect(): Promise<void>;
  /** Must also clean up partially initialized connections; safe to retry after failure. */
  disconnect(): Promise<void>;
  send(message: ChannelOutboundMessage): Promise<void>;
}
export interface ChannelAdapterFactory {
  readonly descriptor: ChannelDescriptor;
  /** Non-secret account identity for preventing duplicate local transport connections. */
  accountId?(credentials: ChannelCredentials): string;
  /** Explicitly allowlisted non-secret fields for settings display. Never return tokens or secrets. */
  publicIdentity?(credentials: ChannelCredentials): Readonly<Record<string, string>>;
  /** Construction must not start network connections. */
  create(context: ChannelAdapterContext): ChannelAdapter;
}
/** Host supplies encrypted, device-local storage; never use renderer localStorage. */
export interface ChannelCredentialStore {
  read(connectionId: string): Promise<ChannelCredentials | null>;
  write(connectionId: string, credentials: ChannelCredentials): Promise<void>;
  remove(connectionId: string): Promise<void>;
}
export interface ChannelConnectionStore {
  list(): Promise<readonly ChannelConnection[]>;
  write(connection: ChannelConnection): Promise<void>;
  remove(connectionId: string): Promise<void>;
}
export interface ChannelSessionStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, sessionId: string): Promise<void>;
}
/** Host implementation calls provider.prompt/onEvent and preserves its permission/persistence flow. */
export interface ChannelAgentBridge {
  handle(input: {
    sessionId: string;
    message: ChannelInboundMessage;
    signal: AbortSignal;
    knowledge?: ChannelKnowledgeBinding;
    reply(message: ChannelOutboundMessage): Promise<void>;
  }): Promise<void>;
}
