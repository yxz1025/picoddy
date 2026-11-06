import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pencil, Save, X, LoaderCircle } from 'lucide-react';

type Result = { ok: boolean; error?: string; ready?: boolean; mode?: 'preview' | 'edit'; closed?: boolean };
const desktop = () => (window as unknown as { electronAPI?: { call: (name: string, input: unknown) => Promise<Result> } }).electronAPI;
export function supportsOfficePreview(path?: string) {
  return Boolean(desktop()?.call && path && /\.(docx|xlsx|pptx)$/i.test(path));
}

export default function OfficePreview({ filePath, fallback }: { filePath: string; fallback: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null);
  const leaseRef = useRef('');
  const [request, setRequest] = useState<{ mode: 'preview' | 'edit' | 'resume'; revision: number }>({ mode: 'resume', revision: 0 });
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [basic, setBasic] = useState(false);
  const call = (name: string, input: Record<string, unknown> = {}) => desktop()!.call(`office.${name}`, { lease: leaseRef.current, ...input });

  useEffect(() => {
    if (basic) return;
    const api = desktop();
    if (!api) return;
    const lease = crypto.randomUUID();
    leaseRef.current = lease;
    let cancelled = false;
    let opened = false;
    let pending = false;
    let previousLayout = '';
    setReady(false); setError(''); setMessage('');
    const invoke = (name: string, input: Record<string, unknown> = {}) => api.call(`office.${name}`, { lease, ...input });
    const update = async () => {
      if (!opened || cancelled || pending || !surface.current) return;
      pending = true;
      try {
        const rect = surface.current.getBoundingClientRect();
        // Native child views sit above the DOM. Hide them whenever a DOM overlay
        // covers the preview (settings, permission dialogs, menus, etc.).
        const points = [[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]];
        const visible = document.visibilityState === 'visible' && rect.width > 0 && rect.height > 0 &&
          points.every(([x,y]) => {
            const top = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
            return top === surface.current || Boolean(top && surface.current?.contains(top));
          });
        const layout = { bounds: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.width, height: rect.height }, visible, theme: document.documentElement.getAttribute('data-theme') || 'light' };
        const key = JSON.stringify(layout);
        if (key !== previousLayout) { await invoke('layout', layout); previousLayout = key; }
        const status = await invoke('status');
        if (!cancelled) {
          setReady(Boolean(status.ready));
          if (status.error) setError(status.error);
        }
      } catch (reason) { if (!cancelled) setError(String(reason)); }
      finally { pending = false; }
    };
    void invoke('open', { path: filePath, mode: request.mode, bounds: surface.current?.getBoundingClientRect().toJSON() }).then(result => {
      if (cancelled) { void invoke('hide'); return; }
      if (!result.ok) { setError(result.error || 'Office 打开失败'); return; }
      opened = true;
      setMode(result.mode || 'preview');
      void update();
    }).catch(reason => { if (!cancelled) setError(String(reason)); });
    const interval = window.setInterval(() => void update(), 250);
    const observer = new ResizeObserver(() => void update());
    if (surface.current) observer.observe(surface.current);
    return () => {
      cancelled = true; clearInterval(interval); observer.disconnect();
      void invoke('hide').catch(() => {});
    };
  }, [filePath, request, basic]);

  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const result = await call('save');
      setMessage(result.ok ? '已保存到原文件' : result.error || '保存失败');
    } catch (reason) { setMessage(String(reason)); }
    finally { setBusy(false); }
  };
  const close = async (useBasic = false) => {
    setBusy(true);
    try {
      const result = await call('close');
      if (!result.ok) { setMessage(result.error || '关闭失败'); return; }
      if (!result.closed) return;
      if (useBasic) setBasic(true);
      else setRequest(value => ({ mode: 'preview', revision: value.revision + 1 }));
    } catch (reason) { setMessage(String(reason)); }
    finally { setBusy(false); }
  };
  if (basic) return <div className="office-preview"><div className="office-toolbar"><span>基础预览</span><button onClick={() => { setBasic(false); setRequest({ mode: 'resume', revision: request.revision + 1 }); }}>重新打开 Office</button></div><div className="office-fallback">{fallback}</div></div>;
  return <div className="office-preview">
    <div className="office-toolbar">
      <span className="office-mode">{mode === 'edit' ? '编辑中' : '文档预览'}</span>
      <span className="office-message" role="status">{message}</span>
      {mode === 'preview' ? <button disabled={!ready || busy || Boolean(error)} onClick={() => setRequest({ mode: 'edit', revision: request.revision + 1 })}><Pencil size={13} />编辑</button> : <>
        <button disabled={!ready || busy || Boolean(error)} onClick={() => void save()}><Save size={13} />{busy ? '处理中…' : '保存'}</button>
        <button disabled={busy} onClick={() => void close()} title="结束编辑并返回预览"><X size={13} />结束编辑</button>
      </>}
    </div>
    <div className="office-surface" ref={surface}>
      {error ? <div className="office-placeholder" role="alert"><p>{error}</p><button disabled={busy} onClick={() => void close(true)}>使用基础预览</button><button onClick={() => setRequest({ mode: 'resume', revision: request.revision + 1 })}>返回编辑会话</button></div>
        : !ready ? <div className="office-placeholder"><LoaderCircle size={20} /><span>正在打开 Office 文档…</span></div> : null}
    </div>
  </div>;
}
