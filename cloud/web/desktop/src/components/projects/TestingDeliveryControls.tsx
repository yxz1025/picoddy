import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../api/client';

type Asset = { id: string; name: string; hash: string };
type Target = { repoId: string; versionId: string; folderId: string };
type Receipt = { row: number; name: string; state: string; id?: string; error?: string; reused?: boolean; target: Target };
type Detail = { asset: Asset; count: number; results: Receipt[] };

export default function TestingDeliveryControls({ conversationId, disabled, customField, revision, refreshAssets, onWorking }: {
  conversationId: string; disabled: boolean; customField: string; revision: number; refreshAssets: () => Promise<void>; onWorking: (working: boolean) => void;
}) {
  const [candidates, setCandidates] = useState<Asset[]>([]);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [working, setWorking] = useState<'submit' | 'import' | ''>('');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const operation = useRef(false);
  const base = `/api/conversations/${encodeURIComponent(conversationId)}/testing-delivery`;
  useEffect(() => {
    if (disabled || !conversationId || working) return;
    let cancelled = false;
    void apiGet<{ candidates?: Asset[]; busy?: boolean }>(base).then(value => {
      if (cancelled || value.busy) return;
      const assets = value.candidates || [];
      setCandidates(assets);
      setSelected(previous => assets.some(asset => asset.id === previous) ? previous : assets.length === 1 ? assets[0].id : '');
    }).catch(error => { if (!cancelled) setMessage(String(error)); });
    return () => { cancelled = true; };
  }, [base, disabled, revision, retry, working]);
  useEffect(() => {
    if (working) return;
    setDetail(null);
    if (!selected || disabled) { setDetailLoading(false); return; }
    let cancelled = false;
    setDetailLoading(true);
    void apiGet<Detail>(`${base}?assetId=${encodeURIComponent(selected)}`).then(value => {
      if (cancelled) return;
      if (!value.asset) throw new Error('会话正在处理，请稍候刷新');
      setDetail(value);
    }).catch(error => { if (!cancelled) setMessage(String(error)); }).finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [base, selected, candidates, disabled, working]);
  const candidate = candidates.find(asset => asset.id === selected);
  const blocked = !selected ? '请先提交测试产物并选择用例 Excel' : detailLoading ? '正在读取 Excel，请稍候' : !detail || detail.asset.id !== selected || detail.asset.hash !== candidate?.hash ? 'Excel 详情尚未就绪，请刷新文件' : '';
  async function execute(action: 'submit' | 'import') {
    if (operation.current) return;
    if (disabled) { setMessage('会话尚未就绪或正在处理，请稍候'); return; }
    if (action === 'import' && (blocked || !detail)) { setMessage(blocked || '请选择用例文件'); return; }
    const selectedDetail = detail;
    operation.current = true; setWorking(action); onWorking(true);
    setMessage(action === 'import' ? '正在校验选定版本并准备需求用例目录，将按每批最多 200 条上传…' : '正在提交测试产物…');
    let timer: ReturnType<typeof setInterval> | undefined;
    if (action === 'import' && selectedDetail) timer = setInterval(() => {
      void apiGet<{ asset: Asset; results: Receipt[] }>(`${base}?assetId=${encodeURIComponent(selectedDetail.asset.id)}&resultsOnly=1`).then(value => {
        if (operation.current && value.asset?.hash === selectedDetail.asset.hash) {
          setDetail({ ...selectedDetail, results: value.results });
          setMessage(`正在上传：已完成 ${value.results.filter(row => row.state === 'linked').length}/${selectedDetail.count} 条`);
        }
      }).catch(() => { /* Submission response reports operation errors. */ });
    }, 2000);
    try {
      if (action === 'submit') {
        const result = await apiPost<{ count: number }>(base, { action, customField });
        setMessage(`已提交 ${result.count} 份测试产物到需求资产及 TAPD 附件`);
        await refreshAssets();
      } else if (selectedDetail) {
        const result = await apiPost<{ results: Receipt[] }>(base, { action, assetId: selectedDetail.asset.id, hash: selectedDetail.asset.hash });
        setDetail({ ...selectedDetail, results: result.results });
        const done = result.results.filter(row => row.state === 'linked').length;
        const unknown = result.results.filter(row => row.state === 'creating' || row.state === 'unknown').length;
        setMessage(`已完成 ${done}/${selectedDetail.count} 条；未完成 ${selectedDetail.count - done - unknown} 条；结果未知 ${unknown} 条`);
      }
    } catch (error) { setMessage(String(error)); if (action === 'submit') await refreshAssets().catch(() => {}); }
    finally { if (timer) clearInterval(timer); operation.current = false; setWorking(''); onWorking(false); setRetry(value => value + 1); }
  }
  return <>
    <button className="rq-complete" disabled={disabled || !!working || !customField.trim()} onClick={() => void execute('submit')}>{working === 'submit' ? '正在提交测试产物…' : '提交测试产物'}</button>
    <button className="rq-button" disabled={disabled || !!working} onClick={() => { setMessage(''); setOpen(true); }}>上传用例到 TAPD</button>
    {message && !open && <span role="status">{message}</span>}
    {open && <div className="rq-editor-backdrop"><section className="rq-editor rq-testing-import" role="dialog" aria-modal="true" aria-label="上传 Excel 用例到 TAPD">
      <h3>上传用例到 TAPD 测试协同</h3>
      <label>用例 Excel<select value={selected} disabled={!!working} onChange={event => { setMessage(''); setSelected(event.target.value); }}><option value="">{candidates.length ? '请选择文件' : '请先提交测试产物'}</option>{candidates.map(asset => <option key={asset.id} value={asset.id}>{asset.name} · {asset.hash.slice(0, 7)}</option>)}</select></label>
      <p>自动上传到当前需求所属 TAPD 项目的「自动测试用例 / 需求 ID-需求标题」目录，缺少目录时自动创建。按每批最多 200 条上传 Excel 用例，并核对等级、步骤、标签及需求关联；已有上传记录在原位置续传，结果未知的用例先核对，不重复创建。</p>
      {detailLoading && <p role="status">正在读取 Excel…</p>}
      {detail && <p>{detail.count} 条用例 · 版本 {detail.asset.hash.slice(0, 12)}</p>}
      {!working && blocked && <p role="alert">{blocked}</p>}
      {message && <p className="rq-testing-status" role="status" aria-live="polite">{message}</p>}
      {!!detail?.results.length && <div className="rq-testing-results">{detail.results.map(row => <article key={row.row}><strong>第 {row.row} 行 · {row.name}</strong><span>{({ linked: row.reused ? '已存在，已复用' : '已创建并关联', created: '已创建，需求关联待核对', creating: '正在创建', failed: '失败，可重试', unknown: '创建结果未知，续传将先核对' } as Record<string, string>)[row.state]}</span>{row.id && <span>TAPD 用例 ID：{row.id}</span>}{row.error && <p role="alert">{row.error}</p>}</article>)}</div>}
      <footer><button disabled={!!working} onClick={() => setOpen(false)}>关闭</button><button disabled={disabled || !!working || detailLoading} onClick={() => setRetry(value => value + 1)}>刷新文件</button><button disabled={disabled || !!working || !!blocked} onClick={() => void execute('import')}>{working === 'import' ? '正在上传…' : '上传选定版本 / 续传'}</button></footer>
    </section></div>}
  </>;
}
