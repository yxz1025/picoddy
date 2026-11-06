import { extname } from 'node:path';
export type OfficeKind = 'docx' | 'xlsx' | 'pptx';
export type OfficeMode = 'preview' | 'edit';
export function officeKind(path: string): OfficeKind | null {
  const ext = extname(path).slice(1).toLowerCase();
  return ext === 'docx' || ext === 'xlsx' || ext === 'pptx' ? ext : null;
}
export interface OfficeHost {
  setVisible(visible: boolean): void;
  requestClose(): Promise<boolean>;
  dispose(): void;
}
/** Serialized by the IPC adapter. Hidden editing sessions retain unsaved work. */
export class OfficeSessions<H extends OfficeHost> {
  readonly entries = new Map<string, { host: H; mode: OfficeMode }>();
  active: { path: string; lease: string } | null = null;
  constructor(private create: (path: string, mode: OfficeMode) => Promise<H>) {}
  async open(path: string, mode: OfficeMode, lease: string): Promise<H> {
    let entry = this.entries.get(path);
    if (entry && entry.mode !== mode) {
      if (!await entry.host.requestClose()) throw new Error('已取消切换，未保存内容仍保留在编辑器中');
      entry.host.dispose(); this.entries.delete(path); entry = undefined;
    }
    if (!entry) {
      if (this.entries.size >= 8) throw new Error('已打开 8 个 Office 会话，请先关闭不需要的编辑会话');
      entry = { host: await this.create(path, mode), mode };
      this.entries.set(path, entry);
    }
    for (const [key, item] of this.entries) {
      item.host.setVisible(false);
      if (key !== path && item.mode === 'preview') { item.host.dispose(); this.entries.delete(key); }
    }
    this.active = { path, lease };
    entry.host.setVisible(true);
    return entry.host;
  }
  get(lease: string) {
    return this.active?.lease === lease ? this.entries.get(this.active.path)?.host : undefined;
  }
  hide(lease: string) {
    const host = this.get(lease);
    if (!host || !this.active) return;
    host.setVisible(false);
    if (this.entries.get(this.active.path)?.mode === 'preview') {
      host.dispose(); this.entries.delete(this.active.path); this.active = null;
    }
  }
  async close(lease: string) {
    const host = this.get(lease);
    if (!host) return true;
    if (!await host.requestClose()) return false;
    host.dispose(); this.entries.delete(this.active!.path); this.active = null;
    return true;
  }
  async closeAll() {
    for (const { host } of this.entries.values()) if (!await host.requestClose()) return false;
    for (const { host } of this.entries.values()) host.dispose();
    this.entries.clear(); this.active = null; return true;
  }
}
