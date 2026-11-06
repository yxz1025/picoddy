import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, Lightbulb } from 'lucide-react';
import ConnectorActionLoader from './ConnectorActionLoader';
import './ConnectorCard.css';

export default function ConnectorCard({ name, icon, description, status, actionLabel = '连接', onAction, busy = false, disabled = false, closeOnAction = false, initiallyOpen = false, examples = [], children, actionRef }: {
  name: string; icon: ReactNode; description: string; status?: string; actionLabel?: string; onAction?: () => void;
  busy?: boolean; disabled?: boolean; closeOnAction?: boolean; initiallyOpen?: boolean; examples?: string[]; children?: ReactNode; actionRef?: Ref<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const dialog = useRef<HTMLDivElement>(null), returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const show = () => { returnFocus.current = document.activeElement as HTMLElement; setOpen(true); };
  const act = () => {
    if (disabled || busy) return;
    if (closeOnAction && onAction) setOpen(false); else show();
    onAction?.();
  };
  useEffect(() => {
    if (!open) return;
    const origin = returnFocus.current;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
      if (e.key !== 'Tab') return;
      const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]');
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (origin?.isConnected) origin.focus(); };
  }, [open]);
  return <>
    <article className="ep-card connector-card connector-summary-card" tabIndex={0} role="button" aria-label={`查看 ${name} 详情`} aria-haspopup="dialog" onClick={show} onKeyDown={e => {
      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); show(); }
    }}>
      <div className="connector-card-top"><div className="connector-card-identity"><div className="connector-icon" aria-hidden="true">{icon}</div><div className="connector-name">{name}</div></div>
        <button ref={actionRef} type="button" className="connector-card-control" aria-label={`${actionLabel} ${name}`} title={actionLabel} disabled={disabled || busy} onClick={e => { e.stopPropagation(); act(); }}>{busy ? <ConnectorActionLoader size={18} /> : <Plus size={17} />}</button>
      </div>
      <div className="connector-desc">{description}</div>
      <div className="connector-summary-status" title={status}>{status || '点击查看详情'}</div>
    </article>
    {open && createPortal(<div className="connector-detail-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div ref={dialog} className="connector-detail" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button type="button" className="connector-detail-close" aria-label="关闭连接器详情" onClick={() => setOpen(false)}><X size={20} /></button>
        <div className="connector-detail-icon" aria-hidden="true">{icon}</div>
        <h2 id={titleId}>{name}</h2><p className="connector-detail-description">{description}</p>
        {onAction && <button type="button" className="connector-detail-action" disabled={busy || disabled} onClick={act}>{busy ? '正在处理…' : actionLabel}</button>}
        <div className="connector-detail-content">{children}</div>
        {!!examples.length && <section className="connector-detail-examples"><h3><Lightbulb size={18} />试试这样用</h3>{examples.map(example => <p key={example}>“{example}”</p>)}</section>}
      </div>
    </div>, document.body)}
  </>;
}
