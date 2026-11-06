import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { useSkillStore } from '../store/useSkillStore';
import ConnectorCard from './ConnectorCard';
import { connectorLogo } from './connectorBadgeModel';
import './TapdConnectorCard.css';
import './BuiltinNpmMcpCard.css';

type Status = {
  name: string; description: string; installed: boolean; installing: boolean; configured: boolean;
  hasToken: boolean; conflict: boolean; error?: string; values: Record<string, string>;
  fields: { key: string; label: string; placeholder: string; secret: boolean; url: boolean }[];
};
export default function BuiltinNpmMcpCard({ id, query }: { id: 'gitlab' | 'jenkins'; query: string }) {
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const base = `/api/mcp/builtin/npm/${id}`;
  const name = id === 'gitlab' ? 'GitLab' : 'Jenkins';
  const loadMcp = useSkillStore(s => s.loadMcp);
  useEffect(() => {
    let active = true;
    const load = () => apiGet<Status>(base).then(s => { if (active) setStatus(s); });
    void load().catch(() => { if (active) setError(`无法获取 ${name} 状态，请重试`); });
    const timer = setInterval(() => { void load().catch(() => {}); }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [base, name]);
  const close = () => { setModal(false); setValues({}); setError(''); action.current?.focus(); };
  useEffect(() => {
    if (!modal) return;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [modal, busy]);
  const configure = async () => {
    setBusy(true); setError('');
    try {
      let next = await apiGet<Status>(base);
      if (next.conflict) throw new Error('存在同名手动配置，请先在手动配置中重命名');
      if (!next.installed) next = await apiPost<Status>(`${base}/install`, {});
      setStatus(next); setValues(next.values); setModal(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '安装失败，请重试'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError('');
    try {
      setStatus(await apiPost<Status>(`${base}/configure`, { env: values }));
      await loadMcp();
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试'); }
    finally { setBusy(false); }
  };
  const visible = `${name} ${status?.description ?? (id === 'gitlab' ? '代码仓库 合并请求 议题' : '构建任务 流水线 日志')}`.toLowerCase().includes(query.trim().toLowerCase());
  if (!visible && !modal) return null;
  return <>
    <ConnectorCard actionRef={action} name={name} icon={<img src={connectorLogo({ id })} alt="" />} description={status?.description ?? (id === 'gitlab' ? '管理 GitLab 代码仓库、合并请求和议题' : '管理 Jenkins 构建任务、流水线和构建日志')} status={status?.configured ? '已配置，可在会话中使用' : '未配置'} actionLabel={status?.configured ? '配置连接' : '连接'} busy={busy || status?.installing} onAction={() => void configure()} closeOnAction examples={id === 'gitlab' ? ['查看待评审的合并请求', '总结当前分支的代码变更'] : ['查看最近一次构建结果', '分析失败的构建日志']}>
      <p role="status">{busy && !modal || status?.installing ? '正在准备并下载连接器依赖…' : status?.configured ? '已配置，可在会话中选择使用' : status?.installed ? '依赖已安装，点击加号填写参数' : '点击加号下载依赖并配置'}</p>
      {status?.conflict && <p role="alert">存在同名手动配置，请先重命名后再安装。</p>}
      {!modal && (error || status?.error) && <p role="alert">{error || status?.error}</p>}
    </ConnectorCard>
    {modal && status && createPortal(<div className="tapd-modal-overlay">
      <div ref={dialog} className="tapd-modal npm-mcp-modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-config-title`}>
        <form onSubmit={event => { event.preventDefault(); void save(); }}>
          <header className="tapd-modal-header"><div><h3 id={`${id}-config-title`}>配置 {name}</h3><p>依赖已安装，填写参数后即可启用。</p></div><button className="tapd-close" type="button" disabled={busy} aria-label="关闭" onClick={close}><X size={18} /></button></header>
          <div className="tapd-modal-body">{status.fields.map(field => <label className="npm-mcp-field" key={field.key}>
            <span className="tapd-key-label">{field.label}</span><span className="tapd-key-input"><input type={field.secret ? 'password' : field.url ? 'url' : 'text'} autoComplete={field.secret ? 'new-password' : 'off'} required={!field.secret || !status.hasToken} disabled={busy} value={values[field.key] ?? ''} placeholder={field.secret && status.hasToken ? '已保存，留空保留现有 Token' : field.placeholder} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))} /></span>
          </label>)}{error && <p className="tapd-error" role="alert">{error}</p>}</div>
          <footer className="tapd-modal-footer"><button type="button" className="tapd-cancel" disabled={busy} onClick={close}>取消</button><button type="submit" className="tapd-submit" disabled={busy}>{busy ? '正在保存…' : '保存并启用'}</button></footer>
        </form>
      </div>
    </div>, document.body)}
  </>;
}
