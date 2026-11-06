import { callIPC } from '../../api/client';

export interface ChannelField { key: string; label: string; type: 'text' | 'password' | 'boolean' | 'number'; required?: boolean }
export interface ChannelDescriptor { id: string; name: string; credentialFields: ChannelField[]; configFields: ChannelField[] }
export interface ChannelConnectionView {
  id: string; channelId: string; name: string; identity: Record<string, string>;
  config: Record<string, unknown>; enabled: boolean; configured: boolean;
  knowledge?: { kind: 'directory' | 'obsidian'; directory: string };
  status: { state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'; errorCode?: string };
  lastError?: string;
}
export interface ChannelSnapshot { channels: ChannelDescriptor[]; connections: ChannelConnectionView[] }
export async function channelCall<T = ChannelSnapshot>(action: string, payload?: unknown): Promise<T> {
  const ipc = (window as unknown as { electronAPI?: { call: (name: string, ...args: unknown[]) => Promise<unknown> } }).electronAPI;
  if (!ipc?.call) throw new Error('请在桌面客户端中配置远程通道');
  return callIPC<T>(ipc, `channels.${action}`, payload);
}
