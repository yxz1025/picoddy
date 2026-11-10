import { useCallback, useEffect, useState } from 'react';
import { LayoutDashboard, Plus, Search, RefreshCw, Pencil, Trash2, CalendarClock, ExternalLink, X } from 'lucide-react';
import { apiGet, apiPut, apiDelete, apiPost } from '../api/client';
import type { Automation } from '../store/automationStore';
import { editBoard, previewBoard, type WorkbenchBoard } from './workbench/model';
import './WorkbenchView.css';
export default function WorkbenchView() {
    const [boards, setBoards] = useState<WorkbenchBoard[]>([]);
    const [automations, setAutomations] = useState<Automation[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [settings, setSettings] = useState<WorkbenchBoard | null>(null);
    const load = useCallback(async () => { setLoading(true); try {
        const [items, tasks] = await Promise.all([apiGet<WorkbenchBoard[]>('/api/workbench'), apiGet<Automation[]>('/api/automations').catch(() => [])]);
        setBoards(items);
        setAutomations(tasks);
        setError('');
    }
    catch (e) {
        setError(String(e));
    }
    finally {
        setLoading(false);
    } }, []);
    useEffect(() => { void load(); const refresh = () => void load(); window.addEventListener('focus', refresh); window.addEventListener('workbench-changed', refresh); return () => { window.removeEventListener('focus', refresh); window.removeEventListener('workbench-changed', refresh); }; }, [load]);
    const act = async (fn: () => Promise<unknown>) => { try {
        setError('');
        await fn();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : String(e));
    } };
    const visible = boards.filter(b => `${b.name} ${b.description}`.toLowerCase().includes(query.toLowerCase()));
    return <section className="workbench-view">
    <header className="wb-header"><div><h2>个人工作台</h2><p>把常用页面留在这里，随时查看与更新。</p></div><button className="wb-primary" onClick={() => void act(() => editBoard())}><Plus size={16}/>新建看板</button></header>
    <div className="wb-tools"><label className="wb-search"><Search size={15}/><input aria-label="搜索看板" placeholder="搜索看板" value={query} onChange={e => setQuery(e.target.value)}/></label><button className="wb-button" disabled={loading} onClick={() => void load()}><RefreshCw size={14}/>刷新列表</button></div>
    {error && <p role="alert" className="wb-error">{error}</p>}
    {loading && !boards.length ? <div className="wb-empty">正在加载…</div> : !visible.length ? <div className="wb-empty"><LayoutDashboard size={32}/><h3>{query ? '没有匹配的看板' : '还没有看板'}</h3><p>{query ? '试试其他关键词。' : '通过会话创建页面，在右侧预览中点击「添加到工作台」。'}</p></div> : <div className="wb-list-wrap"><table className="wb-list"><thead><tr><th>看板</th><th>更新状态</th><th>自动更新</th><th>操作</th></tr></thead><tbody>{visible.map(board => <tr key={board.id}>
      <td><button className="wb-row-open" title={board.path} onClick={() => previewBoard(board)} disabled={!board.available}><span className="wb-row-icon"><LayoutDashboard size={17}/></span><span><strong>{board.name}</strong>{board.description && <small>{board.description}</small>}</span></button></td>
      <td><span className={`wb-file-state ${board.available ? 'is-ready' : 'is-missing'}`}>{board.available ? `更新于 ${new Date(board.fileModifiedAt!).toLocaleString()}` : '页面文件不存在或已移动'}</span></td>
      <td>{board.automationId ? (() => { const task = automations.find(item => item.id === board.automationId); return <span className={`wb-task-state ${task?.enabled ? 'is-enabled' : 'is-paused'}`} title={task ? `${task.name}${task.nextRun ? ` · 下次运行 ${new Date(task.nextRun).toLocaleString()}` : ''}` : '关联任务不存在'}>{task ? `${task.name} · ${task.enabled ? '已启用' : '已暂停'}` : '关联任务不存在'}</span>; })() : <span className="wb-task-state">手动更新</span>}</td>
      <td><div className="wb-row-actions"><button className="wb-button" onClick={() => void act(() => editBoard(board))}><Pencil size={14}/>修改</button><button className="wb-button" onClick={() => setSettings(board)}><CalendarClock size={14}/>{board.automationId ? '更新设置' : '设置更新'}</button><button className="wb-icon" aria-label={`在浏览器打开 ${board.name}`} disabled={!board.available} onClick={() => void act(() => apiPost(`/api/workbench/${board.id}/browser`))}><ExternalLink size={15}/></button></div></td>
    </tr>)}</tbody></table></div>}
    {settings && <BoardSettings board={settings} onClose={() => setSettings(null)} onSaved={() => { setSettings(null); void load(); }}/>}
  </section>;
}
function BoardSettings({ board, onClose, onSaved }: {
    board: WorkbenchBoard;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [name, setName] = useState(board.name), [description, setDescription] = useState(board.description), [automationId, setAutomationId] = useState(board.automationId || '');
    const [tasks, setTasks] = useState<Automation[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [removing, setRemoving] = useState(false);
    useEffect(() => { apiGet<Automation[]>('/api/automations').then(setTasks).catch(e => setError(String(e))); }, []);
    useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy)
        onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [busy, onClose]);
    async function save(remove = false) { setBusy(true); try {
        if (remove)
            await apiDelete(`/api/workbench/${board.id}`);
        else
            await apiPut(`/api/workbench/${board.id}`, { name, description, automationId: automationId || null });
        window.dispatchEvent(new Event('workbench-changed'));
        onSaved();
    }
    catch (e) {
        setError(String(e));
    }
    finally {
        setBusy(false);
    } }
    return <div className="wb-overlay" onClick={e => { if (e.target === e.currentTarget && !busy)
        onClose(); }}><form className="wb-dialog" role="dialog" aria-modal="true" aria-label="看板设置" onSubmit={e => { e.preventDefault(); void save(); }}><header><h3>看板设置</h3><button type="button" className="wb-icon" aria-label="关闭" disabled={busy} onClick={onClose}><X size={18}/></button></header><label>名称<input autoFocus required maxLength={100} value={name} onChange={e => setName(e.target.value)}/></label><label>描述<textarea maxLength={500} value={description} onChange={e => setDescription(e.target.value)}/></label><label>更新任务<select value={automationId} onChange={e => setAutomationId(e.target.value)}><option value="">手动维护</option>{board.automationId && !tasks.some(t => t.id === board.automationId) && <option value={board.automationId}>原任务已删除，请重新选择</option>}{tasks.map(t => <option key={t.id} value={t.id}>{t.name}{t.enabled ? '' : '（已暂停）'}</option>)}</select></label><p className="wb-hint">关联已有自动化任务。请在任务提示词中指定更新这个本地页面：</p><code className="wb-path">{board.path}</code><p className="wb-hint">可在「自动化」中新建定时任务后关联；这里不会改变任务原有的更新逻辑。</p>{error && <p role="alert" className="wb-error">{error}</p>}<footer><button type="button" className="wb-button wb-danger" disabled={busy} onClick={() => removing ? void save(true) : setRemoving(true)}><Trash2 size={14}/>{removing ? '确认移出（保留文件）' : '移出工作台'}</button><button className="wb-primary" disabled={busy}>{busy ? '处理中…' : '保存'}</button></footer></form></div>;
}
