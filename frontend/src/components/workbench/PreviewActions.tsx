import { useEffect, useState } from 'react';
import { Plus, ExternalLink, RefreshCw } from 'lucide-react';
import { apiGet, apiPost } from '../../api/client';
import { useStore } from '../../store/useStore';
import type { WorkbenchBoard } from './model';
import '../WorkbenchView.css';
export default function PreviewActions({ path }: {
    path: string;
}) {
    const [board, setBoard] = useState<WorkbenchBoard | null>(null), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
    const currentConvId = useStore(s => s.currentConvId);
    useEffect(() => { let alive = true; const load = () => apiGet<WorkbenchBoard | null>(`/api/workbench?path=${encodeURIComponent(path)}`).then(item => { if (alive)
        setBoard(item); }).catch(() => { if (alive)
        setStatus('无法读取工作台'); }); void load(); window.addEventListener('workbench-changed', load); return () => { alive = false; window.removeEventListener('workbench-changed', load); }; }, [path]);
    async function action(kind: 'save' | 'browser' | 'run') {
        setBusy(true);
        setStatus('');
        try {
            if (kind === 'browser') {
                await apiPost('/api/workbench/browser', { path });
            }
            else {
                const saved = board || await apiPost<WorkbenchBoard>('/api/workbench', { path, name: path.split(/[\\/]/).pop()?.replace(/\.html?$/i, '') || '我的看板', sourceSessionId: currentConvId });
                setBoard(saved);
                window.dispatchEvent(new Event('workbench-changed'));
                if (kind === 'run' && saved.automationId) {
                    await apiPost(`/api/automations/${saved.automationId}/run`);
                    setStatus('已启动更新任务，可在自动化中查看进度');
                }
                else
                    setStatus('已添加到工作台');
            }
        }
        catch (e) {
            setStatus(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(false);
        }
    }
    return <div className="wb-preview-actions"><button className="wb-button" disabled={busy || !!board} onClick={() => void action('save')}><Plus size={13}/>{board ? '已加入工作台' : '添加到工作台'}</button>{board?.automationId && <button className="wb-icon" disabled={busy} title="运行更新任务" aria-label="运行关联任务" onClick={() => void action('run')}><RefreshCw size={14}/></button>}<button className="wb-icon" disabled={busy} title="在浏览器打开" aria-label="在浏览器打开" onClick={() => void action('browser')}><ExternalLink size={14}/></button>{status && <span role="status" className="wb-preview-status">{status}</span>}</div>;
}
