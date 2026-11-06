import { useEffect, useRef, useState } from 'react';
import { Monitor, Play, Square, Camera, Plus, GitBranch, Smartphone } from 'lucide-react';
import { apiGet, apiPost } from '../../api/client';
import type { Repository } from './RequirementInputs';
import { activePreviewStates, type PreviewSnapshot, type PreviewTarget } from '../../../../src/domains/preview/shared/contracts';
import './InteractivePreview.css';
import { useStore } from '../../store/useStore';
import { composePreviewRequest } from '../../utils/previewComposer';
import { chooseFigmaConnector, figmaConnectorCandidates } from './figmaConnectorSelection';

const states = { starting: '启动中', ready: '可交互', stopping: '停止中', stopped: '已停止', failed: '失败', interrupted: '已中断' };
const empty = (stageKey: string, repositoryId: string): PreviewTarget => ({ id: '', revision: 0, name: '', stageKey, repositoryId, kind: 'web', projectPath: '.', miniProjectPath: '.',
  webUrl: 'http://127.0.0.1:5174', viewport: { width: 390, height: 844 }, cliPath: '', entryPath: '', design: { url: '', version: '' }, scenarios: [] });

export default function InteractivePreview({ base, stageKey, repositories, disabled, onAssetsSaved }: {
  base: string; stageKey: string; repositories: Repository[]; disabled: boolean; onAssetsSaved: () => Promise<void>;
}) {
  const url = `${base}/preview`;
  const conversationId = useStore(s => s.currentConvId);
  const [servers, setServers] = useState<Array<{ id: string; name: string }>>([]);
  const [figmaCandidates, setFigmaCandidates] = useState<Array<{ id: string; displayName: string }>>([]);
  useEffect(() => { let active = true; void apiGet<any>('/api/mcp').then(result => {
    const config = result.availableConfig?.mcpServers || result.config?.mcpServers || {};
    if (active) {
      setServers(Object.entries(config).filter(([, entry]: [string, any]) => !entry.disabled && entry.enabled !== false && entry.type !== 'managed-cli').map(([id, entry]: [string, any]) => ({ id, name: entry.displayName || id })));
      setFigmaCandidates(figmaConnectorCandidates(config, result.connected || []));
    }
  }).catch(() => {}); return () => { active = false; }; }, [base]);
  const [data, setData] = useState<PreviewSnapshot>({ targets: [], runs: [], deliveries: [] });
  const [draft, setDraft] = useState<PreviewTarget | null>(null);
  const [scenarioText, setScenarioText] = useState('[]');
  const [buildArgs, setBuildArgs] = useState('[]'), [startArgs, setStartArgs] = useState('[]');
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const mounted = useRef(true);
  const desktop = Boolean((window as unknown as { electronAPI?: { call?: unknown } }).electronAPI?.call);
  const blocked = disabled || working || !desktop;
  const targets = data.targets.filter(t => t.stageKey === stageKey);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    setData({ targets: [], runs: [], deliveries: [] });
    setDraft(null); setError(''); setNotice('');
    if (!desktop) return () => { mounted.current = false; };
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try { const value = await apiGet<PreviewSnapshot>(url); if (active) setData(value); }
      catch (e) { if (active) setError(String(e)); }
      finally { pending = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 2000);
    return () => { active = false; mounted.current = false; clearInterval(timer); };
  }, [url, desktop]);
  async function action(body: object) {
    setWorking(true); setError(''); setNotice('');
    try {
      const result = await apiPost<{ message?: string; paths?: string[] }>(url, body);
      const next = await apiGet<PreviewSnapshot>(url);
      if (mounted.current) { setData(next); if (result.message) setNotice(result.message); }
      return result;
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); return undefined; }
    finally { if (mounted.current) setWorking(false); }
  }
  function edit(target: PreviewTarget) {
    const next = structuredClone(target);
    if (!next.design.server) next.design.server = chooseFigmaConnector(figmaCandidates, [], useStore.getState().composerConnectors);
    setDraft(next); setScenarioText(JSON.stringify(target.scenarios, null, 2)); setBuildArgs(JSON.stringify(target.build?.args || [])); setStartArgs(JSON.stringify(target.start?.args || [])); setError('');
  }
  async function save() {
    if (!draft) return;
    try {
      const target = { ...draft, scenarios: JSON.parse(scenarioText),
        build: draft.build?.file.trim() ? { file: draft.build.file, args: JSON.parse(buildArgs) } : undefined,
        start: draft.start?.file.trim() ? { file: draft.start.file, args: JSON.parse(startArgs) } : undefined };
      if (await action({ action: 'saveTarget', target })) setDraft(null);
    } catch { setError('参数与场景须为合法 JSON 数组'); }
  }
  function field(key: 'name' | 'projectPath' | 'miniProjectPath' | 'webUrl' | 'entryPath' | 'cliPath', label: string, placeholder = '') {
    return <label>{label}<input value={draft?.[key] || ''} placeholder={placeholder} onChange={e => setDraft(d => d && ({ ...d, [key]: e.target.value }))} /></label>;
  }
  return <section className="interactive-preview" aria-label="交互预览">
    <header><div className="ip-heading"><Monitor size={18} /><h3>交互预览</h3></div><p>在真实前端中体验设计，选择场景并记录评审结果。</p></header>
    {!desktop && <p className="ip-notice">请在桌面客户端使用本地预览。浏览器页面不能启动本机运行器。</p>}
    {!repositories.length && <p>先在“代码仓库”中关联前端仓库，再添加预览目标。</p>}
    <button className="ip-primary" disabled={blocked || !repositories.length} onClick={() => edit(empty(stageKey, repositories[0].id))}><Plus size={14} />添加预览目标</button>
    {draft && <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset disabled={blocked}>
        <legend>{draft.id ? '编辑预览目标' : '新建预览目标'}</legend>
        {field('name', '预览名称', '例如：订单页 H5')}
        <label>关联仓库<select value={draft.repositoryId} onChange={e => setDraft({ ...draft, repositoryId: e.target.value })}>{repositories.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label>运行平台<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as PreviewTarget['kind'] })}><option value="web">Web / H5 · 浏览器</option><option value="wechat-mini">微信小程序 · 开发者工具</option></select></label>
        {field('projectPath', '命令工作目录（相对仓库根目录）', '例如 . 或 frontend')}
        <label>Figma MCP<select value={draft.design.server || ''} onChange={e => setDraft({ ...draft, design: { ...draft.design, server: e.target.value } })}><option value="">未关联设计连接器</option>{servers.map(server => <option key={server.id} value={server.id}>{server.name}</option>)}{draft.design.server && !servers.some(s => s.id === draft.design.server) && <option value={draft.design.server}>{draft.design.server}（检查连接配置）</option>}</select></label>
        <p>复用已配置 MCP 的授权。选择连接器后，在会话中读取设计；节点链接用于定位，也可使用支持桌面选中节点的连接器。</p>
        <label>设计节点定位（可选）<input value={draft.design.url} placeholder="https://www.figma.com/design/…" onChange={e => setDraft({ ...draft, design: { ...draft.design, url: e.target.value } })} /></label>
        <label>设计版本 / 说明<input value={draft.design.version} placeholder="例如：订单页评审稿 v2" onChange={e => setDraft({ ...draft, design: { ...draft.design, version: e.target.value } })} /></label>
        {draft.kind === 'web' ? <>
          {field('webUrl', '本地预览地址', 'http://127.0.0.1:5174')}
          <div className="ip-columns">{(['width', 'height'] as const).map(key => <label key={key}>{key === 'width' ? '视口宽度' : '视口高度'}<input type="number" min="240" max="3840" value={draft.viewport[key]} onChange={e => setDraft({ ...draft, viewport: { ...draft.viewport, [key]: Number(e.target.value) } })} /></label>)}</div>
        </> : <>
          {field('miniProjectPath', '小程序输出目录（相对仓库根目录）', '例如 dist/dev/mp-weixin')}
          {field('cliPath', '微信开发者工具 CLI 路径')}
          <button type="button" onClick={() => void action({ action: 'detectWechatCli' }).then(r => {
            if (r?.paths?.length === 1 && mounted.current) setDraft(d => d && ({ ...d, cliPath: r.paths![0] }));
            else if (r?.paths?.length) setNotice(`检测到多个 CLI，请选择并填写：${r.paths.join('；')}`);
          })}>检测本机微信工具</button>
          <p>需安装并登录微信开发者工具、开启 CLI/HTTP 服务；工作区需安装 miniprogram-automator。</p>
        </>}
        {field('entryPath', '页面入口（可选）', draft.kind === 'web' ? '/orders' : '/pages/orders/index')}
        <details><summary>构建与开发服务</summary>
          <p>沿用仓库已有命令；参数填写 JSON 数组。构建命令需执行结束，开发服务命令应持续运行。</p>
          {(['build', 'start'] as const).map(key => <div key={key}>
            <label>{key === 'build' ? '构建可执行文件（可选）' : '开发服务可执行文件（可选）'}<input value={draft[key]?.file || ''} placeholder="npm / pnpm / yarn 或绝对路径" onChange={e => setDraft({ ...draft, [key]: { file: e.target.value, args: [] } })} /></label>
            <label>参数数组<input value={key === 'build' ? buildArgs : startArgs} placeholder={key === 'build' ? '["run","build:weapp"]' : '["run","dev","--","--port","5174","--strictPort"]'} onChange={e => key === 'build' ? setBuildArgs(e.target.value) : setStartArgs(e.target.value)} /></label>
          </div>)}
          <p>留空表示不执行该步骤。Web 无启动命令时连接已有本地服务，无法据此核验服务的代码版本。</p>
        </details>
        <details><summary>模拟场景</summary><p>请让阶段专家按需求编写仓库内 .cjs 场景，再登记下列数组。未配置模块的场景使用实际数据。</p><textarea rows={8} aria-label="场景 JSON" value={scenarioText} onChange={e => setScenarioText(e.target.value)} /><small>{'格式：[ { "id":"empty", "name":"无订单", "entryPath":"/orders", "module":"preview/empty.cjs" } ]'}</small></details>
        <footer><button type="button" onClick={() => setDraft(null)}>取消</button><button className="ip-primary" type="submit">保存配置</button></footer>
      </fieldset>
    </form>}
    {targets.map(target => {
      const run = data.runs.find(r => r.target.id === target.id);
      const active = Boolean(run && activePreviewStates.includes(run.state));
      const selected = selection[target.id] || run?.scenarioId || 'default';
      return <article className="ip-target" key={target.id}>
        <div className="ip-heading">{target.kind === 'web' ? <Monitor size={17} /> : <Smartphone size={17} />}<strong>{target.name}</strong><span className={`ip-state ip-state-${run?.state || 'stopped'}`}>{run ? states[run.state] : '未运行'}</span></div>
        <small>{repositories.find(r => r.id === target.repositoryId)?.name || '仓库已解除关联'} · 配置 v{target.revision}</small>
        {target.design.url && <p className="ip-source">设计来源：{target.design.version || '未标记版本'}<br /><a href={target.design.url} target="_blank" rel="noreferrer">打开 Figma 设计</a></p>}
        {target.workspace ? <div className="ip-workspace"><GitBranch size={14} /><code>{target.workspace.branch}</code><code>{target.workspace.path}</code><small>直接修改关联仓库当前分支，研发继续沿用；保留已有修改。</small></div> : <p>请重新保存目标，绑定关联仓库的当前分支。</p>}
        <p>Figma MCP：{target.design.server || '未绑定'}</p>
        <button disabled={blocked || !conversationId || !target.design.server} onClick={() => conversationId && composePreviewRequest(conversationId, `请根据本阶段需求资产实现目标 ${target.id}（${target.name}）。先用 requirement_preview designTools/readDesign 读取绑定的 Figma MCP 设计，再复用关联分支现有组件编写代码和场景，保留已有修改；完成后 deliver 登记交付，由我点击预览。`)}>在会话中读取设计并实现</button>
        <label>预览场景<select disabled={blocked} value={selected} onChange={e => setSelection({ ...selection, [target.id]: e.target.value })}><option value="default">真实页面 · 默认入口</option>{target.scenarios.map(s => <option key={s.id} value={s.id}>{s.name}{s.module ? ' · 模拟场景' : ' · 实际数据'}</option>)}</select></label>
        <div className="ip-actions"><button className="ip-primary" disabled={blocked || !target.workspace || (active && run?.scenarioId === selected)} onClick={() => void action({ action: 'start', targetId: target.id, scenarioId: selected })}><Play size={14} />{active ? '切换场景' : '启动预览'}</button>
          {active && <button disabled={working} onClick={() => void action({ action: 'stop', runId: run!.id })}><Square size={13} />停止</button>}
          <button disabled={blocked || active} onClick={() => edit(target)}>编辑</button>
        </div>
        {run && <><p role="status">{run.message}</p><small>代码 {run.commit.slice(0, 8)}{run.dirty ? ' · 含未提交修改' : ''}</small>
          {run.state === 'ready' && <div className="ip-capture"><label>评审说明<textarea rows={3} placeholder="记录已查看的流程、问题或结论" value={notes[run.id] || ''} onChange={e => setNotes({ ...notes, [run.id]: e.target.value })} /></label><button disabled={blocked || !notes[run.id]?.trim()} onClick={() => void action({ action: 'capture', runId: run.id, note: notes[run.id] }).then(r => { if (r) void onAssetsSaved().catch(e => { if (mounted.current) setError(`记录已保存，资产列表刷新失败：${String(e)}`); }); })}><Camera size={14} />保存截图与评审记录</button></div>}
          {!!run.logs.length && <details><summary>运行日志</summary><pre>{run.logs.join('\n')}</pre></details>}
        </>}
        <details><summary>管理与历史</summary><p>删除目标仅移除配置，保留仓库文件和运行记录。</p><button disabled={blocked || active} onClick={() => void action({ action: 'removeTarget', targetId: target.id })}>移除配置</button>{data.runs.filter(r => r.target.id === target.id && r.id !== run?.id).slice(0, 5).map(r => <p key={r.id}>{new Date(r.createdAt).toLocaleString()} · {states[r.state]} · {r.scenarioId}</p>)}</details>
      </article>;
    })}
    {!targets.length && !draft && repositories.length > 0 && <p className="ip-empty">本阶段还没有预览目标。配置后可在对应运行窗口中体验页面与交互。</p>}
    {data.runs.some(r => r.target.stageKey === stageKey && !data.targets.some(t => t.id === r.target.id)) && <details><summary>已移除目标的运行记录</summary>{data.runs.filter(r => r.target.stageKey === stageKey && !data.targets.some(t => t.id === r.target.id)).map(r => <p key={r.id}>{r.target.name} · {new Date(r.createdAt).toLocaleString()} · {states[r.state]}<br />{r.message}</p>)}</details>}
    {working && <p role="status">正在处理…</p>}
    {notice && <p className="ip-notice" role="status">{notice}</p>}
    {error && <p className="ip-error" role="alert">{error}</p>}
  </section>;
}
