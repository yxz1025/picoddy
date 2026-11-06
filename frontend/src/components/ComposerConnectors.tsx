import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { connectorBadge, connectorLogo } from './connectorBadgeModel';
import { connectorSelectionKey, type ConnectorSelection } from './composerConnectorSelection';

function ConnectorGlyph({ connector, large = false }: { connector: ConnectorSelection; large?: boolean }) {
  const logo = connectorLogo(connector);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logo]);
  const badge = connectorBadge(connector);
  return <span className={`composer-connector-control__glyph ${large ? 'is-large' : ''} ${logo && !failed ? 'has-logo' : ''}`} style={{ '--connector-hue': badge.hue } as CSSProperties} aria-hidden="true">
    {logo && !failed ? <img src={logo} alt="" onError={() => setFailed(true)} /> : badge.initial}
  </span>;
}

export default function ComposerConnectors({ connectors, disabled, onRemove, onManage }: {
  connectors: readonly ConnectorSelection[];
  disabled: boolean;
  onRemove(connector: ConnectorSelection): void;
  onManage(): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(null); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        root.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus();
        setOpen(null);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  if (!connectors.length) return null;
  return <div className="composer-connector-controls" ref={root} role="group" aria-label="已选连接器">
    {connectors.map(connector => {
      const key = connectorSelectionKey(connector);
      return <div className="composer-connector-control" key={key}>
        <button type="button" className="composer-connector-control__trigger" aria-label={`当前连接器：${connector.displayName}`} title={connector.displayName} aria-haspopup="menu" aria-expanded={open === key} disabled={disabled} onClick={() => setOpen(open === key ? null : key)}>
          <ConnectorGlyph connector={connector} />
        </button>
        {open === key && <div className="composer-connector-control__popover" role="menu" aria-label={connector.displayName}>
          <div className="composer-connector-control__current">
            <ConnectorGlyph connector={connector} large />
            <span className="composer-connector-control__name">{connector.displayName}</span>
            <button type="button" role="switch" aria-checked="true" className="composer-connector-control__switch is-on" disabled={disabled} title="取消使用此连接器" aria-label={`取消使用连接器 ${connector.displayName}`} onClick={() => { onRemove(connector); setOpen(null); }}><span /></button>
          </div>
          <button type="button" role="menuitem" className="composer-connector-control__manage" onClick={() => { setOpen(null); onManage(); }}><span aria-hidden="true">↗</span><span>管理连接器</span></button>
        </div>}
      </div>;
    })}
  </div>;
}
