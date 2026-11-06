import { useProjectAuthorization } from "./ProjectAuthorization";
import { useEffect, useState } from "react";
import { ArrowLeft, FileText, FolderOpen, GitBranch, Laptop, PanelRightClose, PanelRightOpen, RefreshCw } from "lucide-react";
import ChatArea from "../ChatArea";
import Composer from "../Composer";
import { useStore, type Conversation } from "../../store/useStore";
import { useSkillStore } from "../../store/useSkillStore";
import { apiGet, apiPost } from "../../api/client";
import { stages, stageRequestKey, type DemoRun } from "./projectDemo";
import { createStageExpertSummoner, stageExpertIdentity } from "./requirementStageExpert";
import type { ExpertSummary } from "../../types/experts";
import type { SkillHubExpertDetail } from "../skillHubModel";
import "./RequirementChat.css";
import { useRequirementInputs, RepositoryPanel, RepositoryEditor, AssetSelection, type Repository } from "./RequirementInputs";
import TestingDeliveryControls from './TestingDeliveryControls';
import TestingExecutionPanel from '../testing/TestingExecutionPanel';
import InteractivePreview from './InteractivePreview';
import PreviewDeliveryCard, { usePreviewDeliveryFeed } from './PreviewDeliveryCard';
import StageFigmaConnector from './StageFigmaConnector';

const summonStageExpert = createStageExpertSummoner<ExpertSummary>({
  list: () => apiGet<ExpertSummary[]>("/api/experts"),
  detail: ({ namespace, slug }) => apiGet<SkillHubExpertDetail>(`/api/skillhub/experts/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}`),
  install: (input) => apiPost<ExpertSummary>("/api/skillhub/experts/install", input),
});

export default function RequirementChat({ run, customField, stageIndex, onStage, onBack, onComplete, completing, initialPanel, onPanelChange }: {
  initialPanel?: string | null; onPanelChange?: (panel: string | null) => void;
  run: DemoRun; customField: string; stageIndex: number; onStage: (index: number) => void; onBack: () => void;
  onComplete: (submission: { conversationId: string; expectedStatus: string; targetStatus: string }) => Promise<void>; completing: boolean;
}) {
  const [panel, setPanel] = useState<"context" | "tasks" | "assets" | "repositories" | "testing" | "preview" | null>(initialPanel === null ? null : (["context", "tasks", "assets", "repositories", "testing", "preview"].includes(initialPanel || "") ? initialPanel as "context" : stageIndex >= 3 ? "repositories" : "context"));
  const authorization = useProjectAuthorization();
  useEffect(() => { onPanelChange?.(panel); }, [panel]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => { if (authorization.revision && !ready) setRetry(v => v + 1); }, [authorization.revision]);
  const [conversationId, setConversationId] = useState("");
  const [workflow, setWorkflow] = useState<{ current: string; currentLabel: string; targets: Array<{ value: string; label: string }>; count: number; workflowError?: string } | null>(null);
  const [target, setTarget] = useState("");
  const [workflowRetry, setWorkflowRetry] = useState(0);
  const [completionError, setCompletionError] = useState("");
  const [completionPending, setCompletionPending] = useState(false);
  const [testingWorking, setTestingWorking] = useState(false);
  const messageCount = useStore(s => s.messages.length);
  const agentBusy = useStore((s) => s.busy);
  const busy = agentBusy || testingWorking;
  const showArtifacts = useStore((s) => s.showArtifacts);
  const setShowArtifacts = useStore((s) => s.setShowArtifacts);
  const openPanel = (nextPanel: "context" | "tasks" | "assets" | "repositories" | "testing" | "preview") => {
    if (showArtifacts) setShowArtifacts(false);
    setPanel(nextPanel);
  };
  const stage = stages[stageIndex];
  const [boundExpert, setBoundExpert] = useState("");
  const [assets, setAssets] = useState<Array<{ id: string; name: string; stage: number; sourceId?: string; confirmed?: boolean; path: string; hash: string; syncStatus: string; error?: string; content?: string }>>([]);
  const base = `/api/tapd/requirements/${encodeURIComponent(run.tapdWorkspaceId!)}/${encodeURIComponent(run.tapdId!)}`;
  const previewFeed = usePreviewDeliveryFeed(base);
  const inputs = useRequirementInputs(base, stageRequestKey(stageIndex), completing);
  const [editingRepository, setEditingRepository] = useState<Repository | null | undefined>(undefined);
  const inputBlocked = !inputs.data || inputs.saving || (stageIndex >= 3 && stageIndex !== 7 && !inputs.data.selection.discussionOnly && !inputs.data.selection.repositories.length);
  async function refreshAssets() { setAssets(await apiGet(`${base}/assets`)); }
  useEffect(() => { if (busy) return; void refreshAssets().catch((e) => setError(String(e))); }, [base, completing, busy, messageCount]);
  useEffect(() => {
    if (!ready || busy || completing || !conversationId || authorization.blocked) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setWorkflow(null); setCompletionError(""); setCompletionPending(true);
    async function readCompletion() {
      try {
        const value = await apiGet<{ busy: true } | (NonNullable<typeof workflow> & { busy?: false })>(`/api/conversations/${encodeURIComponent(conversationId)}/requirement-completion`);
        if (cancelled) return;
        if (!('targets' in value)) {
          timer = setTimeout(() => void readCompletion(), 1000);
          return;
        }
        setCompletionPending(false);
        setWorkflow(value);
        setCompletionError(value.workflowError || '');
        setTarget(previous => value.targets.some(t => t.value === previous) ? previous : value.targets.length === 1 ? value.targets[0].value : "");
      } catch (e) {
        if (!cancelled) { setCompletionPending(false); setCompletionError(String(e)); }
      }
    }
    void readCompletion();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [conversationId, ready, busy, messageCount, workflowRetry, authorization.blocked, authorization.revision]);

  useEffect(() => {
    let cancelled = false;
    setReady(false); setError("");
    void (async () => {
      try {
        const identity = stageExpertIdentity(stageIndex);
        if (!identity) throw new Error("当前阶段尚未配置市场专家，请配置后重试");
        const expert = await summonStageExpert(identity);
        if (cancelled) return;
        await useSkillStore.getState().loadExperts();
        if (cancelled) return;

        const state = useStore.getState();
        const response = await apiPost<{ conversationId: string; conversation: Conversation }>(
          `/api/tapd/requirements/${encodeURIComponent(run.tapdWorkspaceId!)}/${encodeURIComponent(run.tapdId!)}/conversations`,
          { title: `${run.title} · ${stage.title}`, requestKey: stageRequestKey(stageIndex), expertId: expert.id,
            modelProvider: state.modelProvider, modelId: state.modelId },
        );
        if (cancelled) return;
        if (!response.conversation) throw new Error("请重启后端以加载需求会话接口更新");
        useStore.setState((s) => ({ conversations: [...s.conversations.filter((c) => c.id !== response.conversationId), { ...response.conversation, requirementScoped: true, requirementContext: undefined }] }));
        await useStore.getState().selectConversation(response.conversationId, { preserveCategory: true });
        if (!cancelled) { setConversationId(response.conversationId); setBoundExpert(response.conversation.expert?.name || "未绑定"); setReady(true); }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "无法打开需求会话"); }
    })();
    return () => { cancelled = true; };
  }, [run.tapdWorkspaceId, run.tapdId, stageIndex, retry]);

  return <section className="rq-chat">
    <header className="rq-header">
      <button className="rq-icon" aria-label="返回需求列表" disabled={testingWorking} onClick={onBack}><ArrowLeft size={18} /></button>
      <div className="rq-identity"><h1 title={run.title}>{run.title}</h1></div>
      <span className="rq-status" title={run.tapdSyncedAt ? `上次同步：${new Date(run.tapdSyncedAt).toLocaleString()}` : "本地保存的状态，尚未核实同步时间"}>{run.tapdStatus || "状态未知"}{authorization.blocked ? " · 上次同步" : ""}</span>
      <button className="rq-icon" aria-label={panel && !showArtifacts ? "收起上下文" : "展开上下文"} onClick={() => showArtifacts ? openPanel(panel || "context") : setPanel(panel ? null : "context")}>{panel && !showArtifacts ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button>
    </header>
    <div className="rq-toolbar"><div className="rq-toolbar-primary"><label>当前阶段 <select aria-label="当前研发阶段" value={stageIndex} disabled={busy || completing} onChange={(e) => { setReady(false); onStage(Number(e.target.value)); }}>{stages.map((s, i) => <option value={i} key={s.title}>{s.title}{assets.some((a) => a.stage === i && !a.sourceId && a.confirmed !== false) ? " · 已提交产物" : ""}</option>)}</select></label><span className="rq-stage-expert">阶段专家：{ready ? boundExpert : stage.role}</span>
      {stageIndex !== 7 && workflow && <label>TAPD：{workflow.currentLabel} → <select aria-label="完成后的 TAPD 状态" value={target} disabled={busy || completing} onChange={e => setTarget(e.target.value)}><option value="">{workflow.targets.length ? "请选择目标状态" : "无可用流转"}</option>{workflow.targets.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>}
      </div><div className="rq-toolbar-actions">
      {stageIndex !== 7 && <button className="rq-complete" disabled={authorization.blocked || !ready || busy || completing || !workflow?.count || !target} onClick={() => workflow && void onComplete({ conversationId, expectedStatus: workflow.current, targetStatus: target })}>{completing ? "正在上传并流转…" : completionPending ? "正在等待交付就绪…" : `提交文档并完成阶段${workflow ? `（${workflow.count}）` : ""}`}</button>}
      {stageIndex !== 7 && workflow && <button className="rq-icon" aria-label="刷新 TAPD 工作流" disabled={busy || completing} onClick={() => setWorkflowRetry(v => v + 1)}><RefreshCw size={14} /></button>}
      {stageIndex === 7 && <TestingDeliveryControls key={conversationId} conversationId={conversationId} disabled={authorization.blocked || !ready || busy || completing} customField={customField} revision={messageCount} onWorking={setTestingWorking} refreshAssets={async () => { await refreshAssets(); await inputs.refresh(); }} />}
      </div>
      {stageIndex !== 7 && completionError && <span role="alert">{completionError}<button onClick={() => setWorkflowRetry(v => v + 1)}>重试</button></span>}

    </div>
    <div className="rq-body"><main className="rq-conversation">
      {ready && stageIndex === 2 && previewFeed.loaded && <StageFigmaConnector showControls={false} key={conversationId} conversationId={conversationId} bound={previewFeed.snapshot.targets.filter(t => t.stageKey === stageRequestKey(stageIndex)).map(t => t.design.server || '').filter(Boolean)} disabled={busy || completing || authorization.blocked} />}
      {ready ? <div className="chat-layout"><ChatArea showHeader={false} showWelcome={false} renderRunDelivery={sourceMessageId => previewFeed.snapshot.deliveries.filter(d => d.conversationId === conversationId && d.sourceMessageId === sourceMessageId).map(delivery => <PreviewDeliveryCard key={delivery.id} delivery={delivery} snapshot={previewFeed.snapshot} base={base} disabled={busy || completing || authorization.blocked} refresh={previewFeed.refresh} openSettings={() => openPanel('preview')} />)} /><div className="rq-input-summary"><div className="rq-input-summary-row"><span className="rq-input-summary-label">本轮输入</span><div className="rq-input-references" role="group" aria-label="本轮引用的需求、仓库和资产"><button onClick={() => openPanel("context")}>需求 · {run.tapdId}</button>{inputs.data?.selection.discussionOnly ? <span>仅讨论方案</span> : inputs.data?.repositories.filter(r => inputs.data!.selection.repositories.includes(r.id)).map(r => <button className="rq-repository-reference" key={r.id} onClick={() => openPanel("repositories")} title={`${r.path}\n最近校验分支：${r.branch || "未知"} · ${r.commit.slice(0, 10)}\n发送时重新校验；可在仓库面板重新校验`}><span><FolderOpen size={14} aria-hidden="true" />{r.name}</span><span><Laptop size={14} aria-hidden="true" />本地</span><span className="rq-repository-branch"><GitBranch size={14} aria-hidden="true" />{r.branch === "HEAD" ? `分离 HEAD · ${r.commit.slice(0, 7)}` : r.branch || "分支未校验"}</span></button>)}{inputs.data?.selection.assets.map(ref => <button key={ref.id} onClick={() => openPanel("assets")} title={`${inputs.data?.assets.find(a => a.id === ref.id)?.name || "资产"} · ${ref.hash}`}>资产 · {inputs.data?.assets.find(a => a.id === ref.id)?.name} · {ref.hash.slice(0, 7)}</button> )}</div></div>{inputBlocked && <p>请完成仓库关联，或在代码仓库页选择“仅讨论方案”。</p>}{inputs.error && <p role="alert">{inputs.error}</p>}</div><Composer sendDisabled={authorization.blocked || inputBlocked || testingWorking} processing={completionPending || completing} testingPublishField={stageIndex === 7 ? customField : undefined} /></div> : <div className="rq-loading"><RefreshCw size={22} /><p>{error || "正在召唤阶段专家并恢复会话，首次使用会自动下载…"}</p>{error && <button onClick={() => setRetry((v) => v + 1)}>重试</button>}</div>}
    </main>{panel && !showArtifacts && <aside className="rq-inspector"><nav>{([['preview', '交互预览'], ['repositories', '代码仓库'], ['assets', '资产'], ['context', '需求'], ['tasks', '任务']] as const).map(([id, title]) => <button key={id} className={panel === id ? "active" : ""} onClick={() => setPanel(id)}>{title}</button>)}{[3, 7].includes(stageIndex) && <button className={panel === 'testing' ? 'active' : ''} onClick={() => setPanel('testing')}>测试执行</button>}</nav><div className="rq-inspector-content">
      {panel === "preview" && <InteractivePreview key={`${base}:${stageIndex}`} base={base} stageKey={stageRequestKey(stageIndex)} repositories={inputs.data?.repositories || []} disabled={authorization.blocked || completing || busy} onAssetsSaved={refreshAssets} />}
      {panel === "testing" && <TestingExecutionPanel key={base} base={base} repositories={inputs.data?.repositories || []} />}
      {panel === "repositories" && <RepositoryPanel data={inputs.data} disabled={busy || inputs.saving} mutate={inputs.mutate} openEditor={r => setEditingRepository(r || null)} />}
      {panel === "context" && <><div className="rq-context-note">发送消息时自动读取需求详情，以及本阶段勾选的代码仓库与资产版本。切换阶段会恢复独立会话，不修改 TAPD 状态。</div><h3>需求详情</h3><div className="rq-description">{run.description.replace(/<[^>]*>/g, " ")}</div><h3>阶段目标</h3><p>{stage.description}</p></>}
      {panel === "context" && <details className="rq-asset"><summary>流程记录（{run.events.length}）</summary><p className="rq-context-note">本地保存的需求操作记录；TAPD 状态以实时读取结果为准。</p>{run.events.map(event => <article className="rq-asset" key={event.id}><strong>{event.text}</strong><small>{event.time}</small></article>)}{!run.events.length && <p className="rq-empty">暂无流程记录。</p>}</details>}
      {panel === "tasks" && <><h3>关联的 TAPD 任务</h3>{run.tapdTasks?.length ? run.tapdTasks.map((task) => <article className="rq-asset" key={task.id}><strong>{task.name}</strong><small>{task.status} · {task.owner || "未分配"}</small></article>) : <p className="rq-empty">此需求暂无关联任务。</p>}</>}
      {panel === "assets" && <><AssetSelection data={inputs.data} disabled={busy || inputs.saving} mutate={inputs.mutate} /><h3>本地资产</h3>{assets.map((asset) => <article className="rq-asset rq-asset-file" key={asset.id} role="button" tabIndex={0} title="在系统文件夹中打开" onClick={() => { const separator = Math.max(asset.path.lastIndexOf("/"), asset.path.lastIndexOf("\\")); void apiGet(`/api/open?path=${encodeURIComponent(separator >= 0 ? asset.path.slice(0, separator) : asset.path)}`).catch((e) => setError(String(e))); }}><FolderOpen size={15} /><strong>{asset.name}</strong><small>{asset.confirmed === false ? "已交付，待提交 · " : ""}{({ synced: "已同步 TAPD", failed: "同步失败，可重试", pending: "待同步", "local-only": "仅本地" } as Record<string, string>)[asset.syncStatus] || asset.syncStatus}{asset.error ? ` · ${asset.error}` : ""}</small><button disabled={authorization.blocked || busy || completing} onClick={(event) => { event.stopPropagation(); void apiPost(`${base}/assets`, { action: "commit", assetId: asset.id, customField }).then(async () => { await refreshAssets(); await inputs.refresh(); }).catch((e) => setError(String(e))); }}>提交本地修改{asset.stage <= 4 ? "并同步 TAPD" : ""}</button></article>)}{error && <p role="alert">{error}</p>}<h3>旧版阶段文档</h3>{run.outputs.length > 0 && <p>以下为旧版记录，重新提交为本地资产后才会进入专家上下文。</p>}{run.outputs.length === 0 && <p className="rq-empty">会话产物自动登记为本地资产；点击完成阶段后自动上传，全部成功才推进 TAPD 状态。</p>}{run.outputs.map((output, index) => <details className="rq-asset" key={index}><summary><FileText size={15} />{stages[output.stage]?.output || output.content.split("\n")[0].replace(/^#\s*/, "") || "历史产物"}</summary><small>{output.tapdSyncStatus === "synced" ? "已同步 TAPD" : output.tapdSyncStatus === "failed" ? `同步失败：${output.tapdSyncError}` : "本地保存"}</small><pre>{output.content}</pre></details>)}<h3>TAPD 附件</h3><p>选择后下载到本地并供当前及后续阶段引用，单个附件限 10MB。修改工作副本后需提交，才会更新上下文和同步版本。</p>{run.tapdAttachments?.map((file) => <article className="rq-asset" key={file.id}><FolderOpen size={15} /><strong>{file.filename}</strong><button disabled={busy || completing} onClick={() => void apiPost<{ id: string; hash: string }>(`${base}/assets`, { action: "download", attachmentId: file.id, stage: stageIndex }).then(async asset => { await refreshAssets(); if (inputs.data) await inputs.mutate({ action: "select", selection: { ...inputs.data.selection, assets: [...inputs.data.selection.assets.filter(a => a.id !== asset.id), { id: asset.id, hash: asset.hash }] } }); else await inputs.refresh(); }).catch((e) => setError(String(e)))}>下载并引用到本阶段</button></article>)}{!run.tapdAttachments?.length && <p className="rq-empty">暂无附件</p>}</>}
    </div></aside>}</div>
    {editingRepository !== undefined && <><RepositoryEditor repo={editingRepository || undefined} disabled={inputs.saving} close={() => setEditingRepository(undefined)} save={repository => inputs.mutate({ action: "saveRepository", repository })} />{inputs.error && <p className="rq-editor-error" role="alert">{inputs.error}</p>}</>}
  </section>;
}
