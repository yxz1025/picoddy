import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../api/client';
import type { Repository } from '../projects/RequirementInputs';
import { targetKinds, type TestingSnapshot, type TestTarget } from '../../../../src/domains/testing/shared/contracts';
import './TestingExecutionPanel.css';

const kinds = { web: 'Web', microfrontend: '微前端', h5: 'H5', 'wechat-mini': '微信小程序（本地开发者工具）' };
const states = { ready: '待执行', running: '本地执行中', collecting: '正在收集报告', finished: '运行已结束', blocked: '核验受阻', unknown: '结果未知' };
const verdicts = { passed: '测试通过', failed: '测试失败', flaky: '重试通过，存在不稳定项', incomplete: '测试未完整完成', invalid: '报告无效' };
const empty = (): Omit<TestTarget, 'revision'> => ({ id: '', name: '', repositoryId: '', kind: 'web', connector: '', environment: 'test', baseUrl: '', entryPath: '', versionUrl: '', versionField: 'commit', mini: { projectPath: '.', cliPath: '', appId: '' } });

export default function TestingExecutionPanel({ base, repositories }: { base: string; repositories: Repository[] }) {
  const url = `${base}/testing-execution`;
  const [snapshot, setSnapshot] = useState<TestingSnapshot>({ targets: [], packages: [], runs: [] });
  const [draft, setDraft] = useState<ReturnType<typeof empty> | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [working, setWorking] = useState(false);
  const [targetId, setTargetId] = useState(''); const [testSha, setTestSha] = useState(''); const [path, setPath] = useState('tests/requirement-package.json');
  const [detectingCli, setDetectingCli] = useState(false);
  const [cliPaths, setCliPaths] = useState<string[]>([]);
  const draftRef = useRef(draft); draftRef.current = draft;
  async function detectCli() {
    const original = draft;
    setDetectingCli(true); setError(''); setNotice(''); setCliPaths([]);
    try {
      const result = await apiPost<{ paths: string[]; message: string }>(url, { action: 'detectWechatCli' });
      if (draftRef.current !== original) return;
      setNotice(result.message); setCliPaths(result.paths);
      if (result.paths.length === 1) setDraft(d => d && ({ ...d, mini: { projectPath: '.', appId: '', ...d.mini, cliPath: result.paths[0] } }));
    } catch (e) { if (draftRef.current === original) setError(String(e)); }
    finally { setDetectingCli(false); }
  }
  useEffect(() => { setCliPaths([]); }, [draft?.id, draft?.kind]);
  async function refresh() { setSnapshot(await apiGet<TestingSnapshot>(url)); }
  useEffect(() => {
    let active = true;
    const read = () => void apiGet<TestingSnapshot>(url).then(value => { if (active) { setSnapshot(value); setError(''); } }).catch(e => { if (active) setError(String(e)); });
    read(); const timer = setInterval(read, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [url]);
  async function action(body: object) {
    setWorking(true); setError(''); setNotice('');
    try { const result = await apiPost<{ message?: string }>(url, body); await refresh(); if (result?.message) setNotice(result.message); return true; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { setWorking(false); }
  }
  function field(key: keyof ReturnType<typeof empty>, label: string, placeholder = '', required = true) {
    return <label>{label}<input required={required} value={String(draft?.[key] ?? '')} placeholder={placeholder} onChange={e => setDraft(d => d && ({ ...d, [key]: e.target.value }))} /></label>;
  }
  return <section className="testing-execution" aria-label="测试配置与执行记录">
    <h3>测试配置与执行</h3>
    <p>测试专家根据资产和代码生成单端或跨端用例；获得执行授权后准备数据，通过本地脚本执行并反馈结果。</p>
    <button disabled={working || !repositories.length} onClick={() => setDraft({ ...empty(), name: repositories[0]?.name || '', repositoryId: repositories[0]?.id || '' })}>添加测试目标</button>
    {!repositories.length && <p>请先在代码仓库页关联被测仓库。</p>}
    {snapshot.targets.map(target => <article key={target.id}>
      <strong>{target.name} · {kinds[target.kind]}</strong><small>{target.environment} · {target.kind === 'wechat-mini' ? '本地开发者工具' : target.baseUrl}</small>
      <small>配置版本 {target.revision} · {target.kind === 'wechat-mini' ? '本地顺序执行' : '本地浏览器执行'}</small>
      <button disabled={working} onClick={() => setDraft({ ...target, connector: target.connector === 'jenkins' ? '' : target.connector })}>编辑</button>{' '}
    </article>)}
    {draft && <form onSubmit={e => { e.preventDefault(); void action({ action: 'saveTarget', target: draft }).then(ok => { if (ok) setDraft(null); }); }}>
      <fieldset disabled={working}><legend>测试目标</legend>
        {field('name', '名称')}
        <label>关联仓库<select value={draft.repositoryId} onChange={e => setDraft({ ...draft, repositoryId: e.target.value })}>{repositories.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label>目标类型<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as TestTarget['kind'] })}>{targetKinds.map(k => <option key={k} value={k}>{kinds[k]}</option>)}</select></label>
        {draft.kind === 'wechat-mini' && <>
          {([['projectPath', '小程序项目目录（相对仓库，根目录填 .）'], ['cliPath', '微信开发者工具 CLI 绝对路径'], ['appId', '微信 AppID']] as const).map(([key, label]) => <label key={key}>{label}<input required value={draft.mini?.[key] || ''} onChange={e => setDraft({ ...draft, mini: { projectPath: '.', cliPath: '', appId: '', ...draft.mini, [key]: e.target.value } })} /></label>)}
          <button type="button" disabled={detectingCli} onClick={() => void detectCli()}>{detectingCli ? '正在检测…' : '自动检测 CLI 地址'}</button>
          {cliPaths.length > 1 && <label>检测到多个安装位置<select value={draft.mini?.cliPath || ''} onChange={e => setDraft({ ...draft, mini: { projectPath: '.', appId: '', ...draft.mini, cliPath: e.target.value } })}><option value="">请选择 CLI 地址</option>{cliPaths.map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
          <p>本机需已安装微信开发者工具，开启 CLI/HTTP 调用，目标仓库需安装 miniprogram-automator。编译型项目填写包含 project.config.json 的构建目录。测试专家会在执行前核对环境，使用微信官方自动化 SDK 启动本地脚本。</p>
        </>}
        {draft.kind !== 'wechat-mini' && <>
          {field('baseUrl', '测试页面地址', 'https://test.example.com/page')}
          <p>填写可访问的完整页面地址，支持路径和查询参数。测试专家通过本地 Playwright 浏览器执行，无需 Jenkins。登录态和测试数据在执行前由专家与你确认。</p>
          <details><summary>可选：部署版本校验</summary>
            {field('versionUrl', '部署版本 JSON 地址', 'https://test.example.com/version.json', false)}
            {field('versionField', 'JSON 完整 SHA 字段', 'commit', Boolean(draft.versionUrl))}
            <p>不填写版本地址也可以测试，报告会注明部署版本未核验。</p>
          </details>
        </>}
        <button type="submit">保存配置</button> <button type="button" onClick={() => setDraft(null)}>取消</button>
      </fieldset>
    </form>}
    <details><summary>登记已提交的测试包</summary><form onSubmit={e => { e.preventDefault(); void action({ action: 'importPackage', targetId, testSha, manifestPath: path }); }}>
      <label>目标<select required value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">请选择</option>{snapshot.targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>测试脚本完整 Git SHA<input required value={testSha} onChange={e => setTestSha(e.target.value)} /></label>
      <label>测试包清单相对路径<input required value={path} onChange={e => setPath(e.target.value)} /></label>
      <p>读取指定提交中的文件，核验用例、脚本及本需求 SDD 资产版本。生成脚本不等于已执行。</p>
      <button disabled={working}>登记测试包</button>
    </form></details>
    {snapshot.packages.map(pack => <article key={pack.id}><strong>测试包 · {pack.testSha.slice(0, 10)}</strong><small>{pack.cases.length} 条用例 · {pack.cases.filter(c => c.automation === 'automated').length} 条已映射脚本</small><small>包 ID：{pack.id}</small></article>)}
    <h3>执行记录</h3>
    <p>在测试专家对话中说明测试范围并要求启动，专家会补齐配置和数据条件后执行。仅生成用例或脚本时说明“先不执行”。结果以专家交付的报告为准；本地小程序结果不代表真机验证。</p>
    {!snapshot.runs.length && <p>尚未登记运行。</p>}
    {snapshot.runs.map(run => <article key={run.id}>
      <strong>{run.target.name} · {run.businessSha.slice(0, 10)}</strong><small>{states[run.state]}{run.verdict && ` · ${verdicts[run.verdict]}`}</small><small>{run.reason}</small><small>请求 ID：{run.id}</small>
      {run.outputDir && <small>本地报告：{run.outputDir}</small>}
      {run.state !== 'finished' && <>
        {run.target.connector && run.target.connector !== 'jenkins' && <button disabled={working} onClick={() => void action({ action: 'collect', runId: run.id })}>读取本地运行结果</button>}{' '}
        <button disabled={working} onClick={() => void action({ action: 'closeRun', runId: run.id })}>结束本地跟踪</button><small>结束跟踪不会停止本地执行。直接通过专家脚本执行的结果，请查看会话中交付的报告。</small></>}
      {!!run.attempts?.length && <details><summary>逐用例结果（{run.attempts.length} 次执行）</summary>{run.attempts.map(a => <small key={`${a.caseId}:${a.attempt}`}>{a.caseId} · 第 {a.attempt + 1} 次 · {a.status}</small>)}</details>}
    </article>)}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
