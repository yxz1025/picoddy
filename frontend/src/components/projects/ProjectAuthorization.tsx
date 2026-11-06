import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiGet } from '../../api/client';
import { useStore } from '../../store/useStore';
import { ShieldAlert, RefreshCw } from 'lucide-react';
import './ProjectAuthorization.css';
type Snapshot = { grants: Array<{ authorization: string; expiresAt: string; workspaceId?: string; workspaces?: Array<{ id: string }> }>; broker: string };
const Context = createContext({ blocked: false, revision: 0, setWorkspace: (_id: string) => {} });
export const useProjectAuthorization = () => useContext(Context);
export default function ProjectAuthorization({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState(''); const [status, setStatus] = useState<Snapshot>();
  const openAuthorization = useStore(s => s.openProjectTapdAuthorization);
  const [revision, setRevision] = useState(0); const [error, setError] = useState('');
  const snapshotEpoch = useRef(0);
  const inFlight = useRef(false); const recheck = useRef(false); const mounted = useRef(true);
  const check = useCallback(async () => {
    if (inFlight.current) { recheck.current = true; return; } inFlight.current = true;
    const epoch = snapshotEpoch.current;
    try { const value = await apiGet<Snapshot>('/api/mcp/builtin/tapd'); if (mounted.current && epoch === snapshotEpoch.current) { setStatus(value); setError(''); } }
    catch { if (mounted.current && epoch === snapshotEpoch.current) setError('暂时无法检查 TAPD 授权，本地内容仍可查看。'); }
    finally { inFlight.current = false; if (mounted.current && recheck.current) { recheck.current = false; void check(); } }
  }, []);
  useEffect(() => {
    const refresh = () => { snapshotEpoch.current++; void check(); };
    mounted.current = true;
    void check();
    const timer = setInterval(() => void check(), 15000);
    window.addEventListener('focus', refresh);
    window.addEventListener('project-tapd-auth-error', refresh);
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('project-tapd-auth-error', refresh); };
  }, [check]);
  const blocked = !!status && !status.grants.some(g => g.authorization === 'authorized' && Date.parse(g.expiresAt) > Date.now() + 60000 && (!workspace || g.workspaceId === workspace || g.workspaces?.some(w => w.id === workspace)));
  const wasBlocked = useRef(false);
  useEffect(() => {
    if (wasBlocked.current && !blocked && status) { setRevision(v => v+1); window.dispatchEvent(new Event('project-tapd-restored')); }
    wasBlocked.current = blocked;
  }, [blocked, status]);
  const title = status?.broker === 'unreachable' ? 'TAPD 连接暂不可用' : status?.broker === 'unconfigured' ? 'TAPD 尚未配置' : blocked ? 'TAPD 授权待恢复' : '暂时无法检查 TAPD 授权';
  return <Context.Provider value={{ blocked, revision, setWorkspace }}><div className="project-auth-layout">
    {(blocked || error) && <div role="status" className="project-auth-notice">
      <ShieldAlert size={18} className="project-auth-notice-icon" aria-hidden="true" />
      <div className="project-auth-notice-copy"><strong>{title}</strong><span>已有内容仍可查看，授权后可继续同步与提交。</span></div>
      <div className="project-auth-notice-actions"><button type="button" className="project-auth-primary" onClick={openAuthorization}>前往连接器授权</button><button type="button" className="project-auth-refresh" onClick={() => void check()} title="检查授权状态" aria-label="检查授权状态"><RefreshCw size={15} /></button></div>
    </div>}
    <div className="project-auth-content">{children}</div>
  </div></Context.Provider>;
}
