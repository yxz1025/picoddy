import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../api/client';
import { composePreviewRequest } from '../../utils/previewComposer';
import { activePreviewStates, type PreviewDelivery, type PreviewSnapshot } from '../../../shared/preview';
import './InteractivePreview.css';

export function usePreviewDeliveryFeed(base: string) {
  const [loadedBase, setLoadedBase] = useState('');
  const [snapshot, setSnapshot] = useState<PreviewSnapshot>({ targets: [], runs: [], deliveries: [] });
  async function refresh() { setSnapshot(await apiGet<PreviewSnapshot>(`${base}/preview`)); }
  useEffect(() => {
    let active = true, pending = false;
    setSnapshot({ targets: [], runs: [], deliveries: [] }); setLoadedBase('');
    if (!(window as any).electronAPI?.call) return;
    const read = async () => { if (pending) return; pending = true;
      try { const value = await apiGet<PreviewSnapshot>(`${base}/preview`); if (active) { setSnapshot(value); setLoadedBase(base); } }
      catch { /* Opening preview settings shows the actionable error; ordinary chat remains available. */ }
      finally { pending = false; }
    };
    void read(); const timer = setInterval(() => void read(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [base]);
  return { snapshot, refresh, loaded: loadedBase === base };
}
export default function PreviewDeliveryCard({ delivery, snapshot, base, disabled, refresh, openSettings }: {
  delivery: PreviewDelivery; snapshot: PreviewSnapshot; base: string; disabled: boolean; refresh: () => Promise<void>; openSettings: () => void;
}) {
  const [scenario, setScenario] = useState('default'), [working, setWorking] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [diff, setDiff] = useState(''), [note, setNote] = useState('');
  const target = snapshot.targets.find(t => t.id === delivery.target.id);
  const run = snapshot.runs.find(r => r.deliveryId === delivery.id);
  const active = !!run && activePreviewStates.includes(run.state);
  async function action(body: object) {
    setWorking(true); setError('');
    try { const result = await apiPost<{ message?: string; diff?: string }>(`${base}/preview`, body); if (result.diff) setDiff(result.diff); if (result.message) setNotice(result.message); await refresh(); }
    catch (e) { setError(String(e)); }
    finally { setWorking(false); }
  }
  return <section className="interactive-preview ip-delivery" aria-label="设计代码交付">
    <div className="ip-heading"><strong>{delivery.target.name}</strong><span className="ip-state">代码已交付</span></div>
    <p>{delivery.summary}</p><small>分支 {delivery.target.workspace?.branch} · {delivery.commit.slice(0, 8)}{delivery.dirty ? ' · 含未提交修改' : ''}</small>
    <small>需求资产 {delivery.assetRefs.length} 项 · Figma 读取 {delivery.designReadIds.length} 次</small>
    <details><summary>查看交付说明与文件（{delivery.files.length}）</summary><p>待验证：{delivery.pending || '尚未进行预览验收'}</p><p>目录：{delivery.target.workspace?.path}</p>{delivery.files.map(f => <small key={f.path}>{({ added: '新增', modified: '修改', unchanged: '未变' })[f.change]} · {f.path} · {f.hash.slice(0, 8)}</small>)}<p>文件状态相对仓库 HEAD，可能包含已有修改；交付记录已存入待确认资产。</p></details>
    <label>预览场景<select value={scenario} disabled={working || disabled} onChange={e => setScenario(e.target.value)}><option value="default">默认入口</option>{(target || delivery.target).scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <div className="ip-actions"><button className="ip-primary" disabled={working || disabled || !target || (active && run?.scenarioId === scenario)} onClick={() => void action({ action: 'start', targetId: delivery.target.id, deliveryId: delivery.id, scenarioId: scenario })}>{active ? '切换场景' : run ? '重新预览' : '启动预览'}</button>
      {active && <button disabled={working} onClick={() => void action({ action: 'stop', runId: run.id })}>停止</button>}
      <button disabled={working || disabled} onClick={() => void action({ action: 'deliveryDiff', deliveryId: delivery.id })}>查看代码变更</button><button onClick={openSettings}>预览设置</button></div>
    {!target && <p>目标配置已移除，交付记录仍保留。请先在预览设置中配置目标。</p>}
    {run && <p role="status">{run.message}{run.changedSinceDelivery ? ' · 文件或配置相较交付已变化，当前运行使用最新工作目录。' : ''}</p>}
    {run?.state === 'ready' && <div className="ip-capture"><label>评审说明<textarea value={note} rows={2} onChange={e => setNote(e.target.value)} placeholder="记录已检查的交互或待修改问题" /></label><button disabled={working || disabled || !note.trim()} onClick={() => void action({ action: 'capture', runId: run.id, note })}>保存评审截图</button></div>}
    {(error || run?.state === 'failed') && <div className="ip-error" role="alert"><p>{error || run?.message}</p><button disabled={working || disabled} onClick={() => composePreviewRequest(delivery.conversationId, `请修复交付 ${delivery.id} 的预览问题，目标 ${delivery.target.id}，保持关联分支并保留已有修改。错误：${error || run?.message}\n最近日志：${run?.logs.slice(-8).join('\n') || '无'}\n修复后重新登记代码交付，由我点击预览。`)}>让专家修复</button><small>将修复请求填入当前输入框，由你发送。</small></div>}
    {diff && <details open><summary>当前代码差异</summary><pre>{diff}</pre></details>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
