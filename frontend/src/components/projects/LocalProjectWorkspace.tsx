import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  Check,
  ChevronRight,
  Circle,
  Clock3,
  FilePlus2,
  FileText,
  FolderOpen,
  GitBranch,
  History,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import type { LocalProject, LocalStage } from "../../../../src/domains/project/shared/workflow";
import type { ExpertSummary } from "../../types/experts";
import ChatArea from "../ChatArea";
import Composer from "../Composer";
import { type Conversation, useStore } from "../../store/useStore";
import { apiGet } from "../../api/client";
import { stageStartBlocker } from "./LocalProjectModel";

export type LocalProjectActionResult = LocalProject | { project: LocalProject; conversation: Conversation & { projectScoped?: boolean } };
type WorkspaceTab = "workflow" | "conversations" | "assets" | "events";
type McpChoice = { id: string; label: string };

const stageStatus: Record<LocalStage["status"], string> = {
  pending: "待开始",
  active: "进行中",
  review: "待确认",
  completed: "已完成",
  "needs-review": "待复核",
};

function isStartResult(value: LocalProjectActionResult): value is { project: LocalProject; conversation: Conversation & { projectScoped?: boolean } } {
  return "conversation" in value;
}

function ReviewCard({ project, stage, busy, onAction }: {
  project: LocalProject;
  stage: LocalStage;
  busy: boolean;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<LocalProjectActionResult>;
}) {
  const [summary, setSummary] = useState(stage.review?.summary ?? "");
  const [risks, setRisks] = useState(stage.review?.risks ?? "");
  const [assetIds, setAssetIds] = useState<string[]>(stage.review?.assetIds ?? []);
  const stageAssets = project.assets.filter(asset => asset.stageId === stage.id);

  useEffect(() => { setSummary(stage.review?.summary ?? ""); setRisks(stage.review?.risks ?? ""); setAssetIds(stage.review?.assetIds ?? []); }, [stage.id, stage.review?.version]);

  if (stage.review) return <section className="lp-review-card" aria-labelledby="review-title">
    <header><div><span className="lp-kicker">DELIVERY REVIEW · V{stage.review.version}</span><h3 id="review-title">确认本阶段交付</h3></div><ShieldCheck size={21} /></header>
    <dl><div><dt>交付摘要</dt><dd>{stage.review.summary}</dd></div><div><dt>风险与未决问题</dt><dd>{stage.review.risks || "未记录"}</dd></div></dl>
    <h4>本次确认的文件</h4>
    <div className="lp-review-assets">{stage.review.assetIds.map(id => { const asset = project.assets.find(item => item.id === id); return asset ? <span key={id}><FileText size={14} />{asset.name}<small>v{asset.version} · {asset.hash.slice(0, 8)}</small></span> : <span className="missing" key={id}>文件已缺失 · {id}</span>; })}{stage.review.assetIds.length === 0 && <p>此阶段没有文件产物，确认将只归档上述审核记录。</p>}</div>
    <footer><button className="lp-button" disabled={busy} onClick={() => { document.querySelector<HTMLElement>(".lp-stage-chat .composer-editor")?.focus(); }}><RotateCcw size={14} />继续在会话中修改</button><button className="lp-button lp-button-primary" disabled={busy} onClick={() => void onAction("confirm", { stageId: stage.id, revision: project.revision }).catch(() => {})}><Check size={14} />{project.stages.at(-1)?.id === stage.id ? "确认交付并完成项目" : "确认并进入下一阶段"}</button></footer>
  </section>;

  return <section className="lp-review-draft">
    <div><span className="lp-kicker">SUBMIT DELIVERY</span><h3>提交候选交付</h3><p>模型回复不会自动完成阶段。请整理实际成果，选择要绑定的文件版本。</p></div>
    <label className="lp-field"><span>交付摘要</span><textarea rows={3} value={summary} onChange={event => setSummary(event.target.value)} placeholder="说明完成了什么，以及采用了哪些依据" /></label>
    <label className="lp-field"><span>风险与未决问题</span><textarea rows={2} value={risks} onChange={event => setRisks(event.target.value)} placeholder="没有也请明确写明" /></label>
    <fieldset><legend>选择本阶段实际资产</legend>{stageAssets.map(asset => <label key={asset.id}><input type="checkbox" checked={assetIds.includes(asset.id)} onChange={event => setAssetIds(current => event.target.checked ? [...current, asset.id] : current.filter(id => id !== asset.id))} /><span>{asset.name}<small>v{asset.version} · {asset.hash.slice(0, 8)}</small></span></label>)}{stageAssets.length === 0 && <p>暂无本阶段资产。澄清类阶段可以只提交可审核的文字记录。</p>}</fieldset>
    <button className="lp-button lp-button-primary" disabled={busy || !summary.trim()} onClick={() => void onAction("review", { stageId: stage.id, summary: summary.trim(), risks: risks.trim(), assetIds }).catch(() => {})}>保存并提交审核</button>
  </section>;
}

function ProjectSettingsDialog({ project, experts, connectors, busy, onClose, onAction }: {
  project: LocalProject;
  experts: ExpertSummary[];
  connectors: McpChoice[];
  busy: boolean;
  onClose: () => void;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<LocalProjectActionResult>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [instructions, setInstructions] = useState(project.instructions);
  const [selectedConnectors, setSelectedConnectors] = useState(project.connectors);
  const [stages, setStages] = useState(project.stages.map(stage => ({ id: stage.id, title: stage.title, goal: stage.goal, expertId: stage.expertId, expertName: stage.expertName })));
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = ref.current;
    element?.showModal();
    return () => {
      element?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return <dialog className="lp-dialog lp-settings-dialog" ref={ref} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void onAction("settings", { name: name.trim(), description: description.trim(), instructions: instructions.trim(), connectors: selectedConnectors, stages }).then(onClose).catch(() => {}); }}>
      <header><div><span className="lp-kicker">PROJECT SETTINGS</span><h2>项目设置</h2></div><button type="button" className="lp-icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
      <div className="lp-dialog-body"><label className="lp-field"><span>项目名称</span><input maxLength={40} required value={name} onChange={event => setName(event.target.value)} /></label><label className="lp-field"><span>项目目标</span><textarea rows={4} required value={description} onChange={event => setDescription(event.target.value)} /></label><label className="lp-field"><span>通用指令</span><textarea rows={4} value={instructions} onChange={event => setInstructions(event.target.value)} /></label>
        <h3 className="lp-settings-subtitle">阶段专家</h3>{stages.map((stage, index) => { const persisted = project.stages.find(item => item.id === stage.id); const locked = Boolean(persisted?.conversationId); return <label className="lp-settings-stage" key={stage.id}><span>{String(index + 1).padStart(2, "0")} · {stage.title}<small>{locked ? "已建立会话的阶段保留原专家" : stage.goal}</small></span><select disabled={locked} value={stage.expertId} onChange={event => { const expert = experts.find(item => item.id === event.target.value); setStages(current => current.map(item => item.id === stage.id ? { ...item, expertId: expert?.id ?? "", expertName: expert?.name ?? item.expertName } : item)); }}><option value="">未选择 · 推荐{stage.expertName}</option>{experts.map(expert => <option value={expert.id} key={expert.id}>{expert.name}{expert.catalogSource === "builtin" ? " · 内置" : ""}</option>)}</select></label>; })}
        <h3 className="lp-settings-subtitle">项目连接器</h3><div className="lp-choice-grid">{connectors.map(connector => <label key={connector.id}><input type="checkbox" checked={selectedConnectors.includes(connector.id)} onChange={event => setSelectedConnectors(current => event.target.checked ? [...current, connector.id] : current.filter(id => id !== connector.id))} /><span><strong>{connector.label}</strong><small>{connector.id}</small></span></label>)}</div>
      </div>
      <footer><span>设置不会自动重启会话。</span><div><button type="button" className="lp-button" onClick={onClose}>取消</button><button type="submit" className="lp-button lp-button-primary" disabled={busy}>保存设置</button></div></footer>
    </form>
  </dialog>;
}

export default function LocalProjectWorkspace({ project, experts, connectors, busy, error, initialSettingsOpen, onBack, onAction, onRefresh }: {
  project: LocalProject;
  experts: ExpertSummary[];
  connectors: McpChoice[];
  busy: boolean;
  error: string;
  initialSettingsOpen?: boolean;
  onBack: () => void;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<LocalProjectActionResult>;
  onRefresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<WorkspaceTab>("workflow");
  const [stageId, setStageId] = useState(project.currentStageId);
  const [contextOpen, setContextOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(Boolean(initialSettingsOpen));
  const [assetPath, setAssetPath] = useState("");
  const [repo, setRepo] = useState({ name: "", path: "", role: "主仓库" });
  const currentConvId = useStore(state => state.currentConvId);
  const agentBusy = useStore(state => state.busy);
  const modelProvider = useStore(state => state.modelProvider);
  const modelId = useStore(state => state.modelId);
  const previousCurrentStageId = useRef(project.currentStageId);
  const previousAgentBusy = useRef(agentBusy);
  const stage = project.stages.find(item => item.id === stageId) ?? project.stages[0];
  const currentStage = project.stages.find(item => item.id === project.currentStageId);
  const installedExpertIds = useMemo(() => experts.filter(expert => expert.available).map(expert => expert.id), [experts]);
  const blocker = stage ? stageStartBlocker(stage, installedExpertIds) : "项目没有可用阶段";
  const canStart = stage?.id === project.currentStageId && (stage.status === "pending" || stage.status === "active" || stage.status === "needs-review") && !blocker;

  useEffect(() => { setStageId(project.currentStageId); }, [project.id]);
  useEffect(() => {
    if (previousCurrentStageId.current !== project.currentStageId) {
      previousCurrentStageId.current = project.currentStageId;
      setStageId(project.currentStageId);
    }
  }, [project.currentStageId]);
  useEffect(() => {
    if (previousAgentBusy.current && !agentBusy) void onRefresh();
    previousAgentBusy.current = agentBusy;
  }, [agentBusy, onRefresh]);
  useEffect(() => { if (!project.stages.some(item => item.id === stageId)) setStageId(project.currentStageId); }, [project.stages, project.currentStageId, stageId]);

  const openConversation = async (conversation: Conversation & { projectScoped?: boolean }, projectValue = project) => {
    const selectedConnectors = projectValue.connectors.map(id => ({ id, displayName: connectors.find(item => item.id === id)?.label ?? id, kind: "mcp" as const }));
    useStore.setState(state => ({
      conversations: [...state.conversations.filter(item => item.id !== conversation.id), { ...conversation, projectScoped: true }],
      composerConnectorsByConversation: { ...state.composerConnectorsByConversation, [conversation.id]: selectedConnectors },
    }));
    await useStore.getState().selectConversation(conversation.id, { preserveCategory: true });
  };

  const start = async () => {
    if (!stage || !canStart) return;
    try {
      const result = await onAction("start", { stageId: stage.id, modelProvider, modelId });
      if (isStartResult(result)) await openConversation(result.conversation, result.project);
    } catch { /* The parent renders the actionable API error. */ }
  };
  const resume = async (target: LocalStage) => {
    if (!target.conversationId) return;
    const found = useStore.getState().conversations.find(item => item.id === target.conversationId);
    if (found) await openConversation(found, project);
    else {
      const expert = experts.find(item => item.id === target.expertId) ?? null;
      await openConversation({
        id: target.conversationId,
        title: `${project.name} · ${target.title}`,
        category: "project",
        status: target.status === "active" ? "active" : "idle",
        modelProvider,
        modelId,
        expertId: target.expertId || null,
        expertRevision: expert?.revision ?? null,
        expertCatalogSource: expert?.catalogSource ?? null,
        expert,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        projectScoped: true,
      }, project);
    }
  };
  const showAsset = async (_name: string, path: string) => {
    setContextOpen(false);
    useStore.getState().openPreview(path);
  };

  return <main className="lp-workspace">
    <header className="lp-workspace-header">
      <div className="lp-breadcrumb"><button onClick={onBack}>项目</button><ChevronRight size={13} /><strong>{project.name}</strong>{project.archived && <span>已归档</span>}</div>
      <div className="lp-header-actions"><button className="lp-button" onClick={() => void apiGet(`/api/open?path=${encodeURIComponent(project.dirPath)}`)}><FolderOpen size={14} />打开目录</button><button className="lp-icon-button" onClick={() => setSettingsOpen(true)} aria-label="项目设置"><Settings2 size={17} /></button></div>
    </header>
    <nav className="lp-tabs" aria-label="项目内容">{([['workflow', '工作流'], ['conversations', '会话'], ['assets', '资产'], ['events', '动态']] as const).map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}{id === "assets" && <small>{project.assets.length}</small>}</button>)}</nav>
    {error && <div className="lp-workspace-error" role="alert">{error}<button onClick={() => void onRefresh()}><RefreshCw size={13} />重试</button></div>}

    {tab === "workflow" && stage && <div className={`lp-workflow-layout ${contextOpen ? "" : "context-closed"}`}>
      <aside className="lp-stage-rail" aria-label="项目阶段"><div className="lp-rail-heading"><span>阶段</span><small>{project.stages.filter(item => item.status === "completed").length}/{project.stages.length}</small></div>{project.stages.map((item, index) => <button key={item.id} className={`${stage.id === item.id ? "selected" : ""} status-${item.status}`} disabled={busy || agentBusy} onClick={() => setStageId(item.id)}><span className="lp-stage-node">{item.status === "completed" ? <Check size={13} /> : item.status === "active" || item.status === "review" ? <Circle size={9} fill="currentColor" /> : String(index + 1).padStart(2, "0")}</span><span><strong>{item.title}</strong><small>{item.expertName || "未选择专家"}</small><em>{stageStatus[item.status]}</em></span></button>)}</aside>
      <section className="lp-stage-main">
        <header className="lp-stage-header"><button className="lp-icon-button lp-mobile-back" onClick={onBack} aria-label="返回项目列表"><ArrowLeft size={17} /></button><div><span className="lp-kicker">STAGE {String(project.stages.findIndex(item => item.id === stage.id) + 1).padStart(2, "0")}</span><h1>{stage.title}</h1><p>{stage.goal}</p></div><div><span className={`lp-status lp-status-${stage.status}`}>{stageStatus[stage.status]}</span><button className="lp-icon-button" aria-label={contextOpen ? "收起项目上下文" : "展开项目上下文"} onClick={() => setContextOpen(value => !value)}>{contextOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button></div></header>
        <div className="lp-stage-expert"><span>{stage.expertName?.slice(0, 1) || "?"}</span><div><small>阶段专家</small><strong>{stage.expertName || "尚未选择"}</strong></div>{stage.expertId && !installedExpertIds.includes(stage.expertId) && <em>专家当前不可用</em>}{stage.status === "completed" && !project.archived && <button className="lp-button" disabled={busy || agentBusy} onClick={() => { if (window.confirm(`重新打开「${stage.title}」会让受影响的后续阶段进入待复核状态。继续吗？`)) void onAction("reopen", { stageId: stage.id }).catch(() => {}); }}><RotateCcw size={13} />重新打开阶段</button>}</div>

        {!stage.conversationId && <section className="lp-stage-start"><Play size={20} /><h2>本阶段尚未开始</h2><p>开始会创建或恢复独立会话，并加载项目目标、已确认交付和所选仓库。不会自动发送消息。</p><button className="lp-button lp-button-primary" disabled={busy || agentBusy || !canStart || project.archived} onClick={() => void start()}><Play size={14} />开始本阶段</button>{blocker && <small>{blocker}</small>}{stage.id !== project.currentStageId && <small>请先完成当前阶段「{currentStage?.title}」。</small>}</section>}

        {stage.conversationId && currentConvId !== stage.conversationId && <section className="lp-stage-start"><MessageSquare size={20} /><h2>阶段会话已保存</h2><p>恢复会话只读取历史消息，不会调用模型或继续执行。</p><button className="lp-button lp-button-primary" disabled={busy || agentBusy} onClick={() => void resume(stage)}><MessageSquare size={14} />恢复阶段会话</button></section>}

        {stage.conversationId && currentConvId === stage.conversationId && <div className="lp-stage-chat"><ChatArea showHeader={false} showWelcome={false} /><div className="lp-chat-input-context"><span>本轮项目上下文</span><button onClick={() => setContextOpen(true)}>项目目标</button>{project.repositories.map(repository => <button key={repository.id} onClick={() => setContextOpen(true)}><GitBranch size={12} />{repository.name} · {repository.branch || "未校验"}</button>)}{project.assets.filter(asset => asset.confirmed).slice(-3).map(asset => <button key={asset.id} onClick={() => void showAsset(asset.name, asset.path)}><FileText size={12} />{asset.name} · v{asset.version}</button>)}</div><Composer sendDisabled={project.archived || stage.status === "completed" || stage.status === "pending" || stage.status === "needs-review" || stage.id !== project.currentStageId} processing={busy} /></div>}

        {stage.id === project.currentStageId && stage.conversationId && stage.status !== "completed" && <ReviewCard project={project} stage={stage} busy={busy || agentBusy} onAction={onAction} />}
      </section>
      {contextOpen && <aside className="lp-context"><header><span>项目上下文</span><button className="lp-icon-button" aria-label="收起上下文" onClick={() => setContextOpen(false)}><X size={15} /></button></header><section><span className="lp-kicker">PROJECT BRIEF</span><h3>{project.name}</h3><p>{project.description}</p>{project.instructions && <details><summary>通用指令</summary><p>{project.instructions}</p></details>}</section><section><div className="lp-context-heading"><h3>代码仓库</h3><span>{project.repositories.length}</span></div>{project.repositories.map(repository => <div className="lp-context-item" key={repository.id}><GitBranch size={14} /><span><strong>{repository.name}</strong><small>{repository.role} · {repository.branch || "分支未校验"}{repository.dirty ? " · 有未提交修改" : ""}</small></span></div>)}{project.repositories.length === 0 && <p className="lp-inline-empty">尚未关联代码仓库。</p>}<details className="lp-context-add"><summary><Plus size={13} />关联仓库</summary><input placeholder="仓库名称" value={repo.name} onChange={event => setRepo(current => ({ ...current, name: event.target.value }))} /><input placeholder="本地 Git 路径" value={repo.path} onChange={event => setRepo(current => ({ ...current, path: event.target.value }))} /><select value={repo.role} onChange={event => setRepo(current => ({ ...current, role: event.target.value }))}><option>主仓库</option><option>前端</option><option>后端</option><option>公共库</option></select><button className="lp-button" disabled={!repo.path.trim() || busy} onClick={() => void onAction("repository", repo).then(() => setRepo({ name: "", path: "", role: "主仓库" })).catch(() => {})}>保存并校验</button></details></section><section><div className="lp-context-heading"><h3>共享资产</h3><span>{project.assets.length}</span></div>{project.assets.slice(-6).map(asset => <button className="lp-context-item" key={asset.id} onClick={() => void showAsset(asset.name, asset.path)}><FileText size={14} /><span><strong>{asset.name}</strong><small>{asset.confirmed ? "已确认" : "待确认"} · v{asset.version}</small></span></button>)}{project.assets.length === 0 && <p className="lp-inline-empty">暂无真实文件资产。</p>}</section></aside>}
    </div>}

    {tab === "conversations" && <section className="lp-content-page"><div className="lp-page-title"><span className="lp-kicker">STAGE CONVERSATIONS</span><h1>会话</h1><p>各阶段上下文彼此独立；恢复不会继续执行。</p></div><div className="lp-list">{project.stages.map((item, index) => <article key={item.id}><span className="lp-list-icon"><MessageSquare size={16} /></span><div><small>阶段 {String(index + 1).padStart(2, "0")}</small><h3>{item.title}</h3><p>{item.expertName} · {stageStatus[item.status]}</p></div>{item.conversationId ? <button className="lp-button" onClick={() => { setStageId(item.id); setTab("workflow"); void resume(item); }}>恢复会话</button> : <span className="lp-muted">尚未创建</span>}</article>)}</div></section>}

    {tab === "assets" && <section className="lp-content-page"><div className="lp-page-title"><span className="lp-kicker">LOCAL FILES</span><h1>资产</h1><p>文件来自真实本地路径，确认记录绑定具体版本与哈希。</p></div><form className="lp-import-bar" onSubmit={event => { event.preventDefault(); if (!assetPath.trim()) return; void onAction("asset", { path: assetPath.trim(), stageId: project.currentStageId }).then(() => setAssetPath("")).catch(() => {}); }}><FilePlus2 size={16} /><label><span className="sr-only">本地文件路径</span><input value={assetPath} onChange={event => setAssetPath(event.target.value)} placeholder="输入要导入的本地文件绝对路径" /></label><button className="lp-button lp-button-primary" disabled={!assetPath.trim() || busy}>导入文件</button></form><div className="lp-asset-table"><div className="lp-asset-row lp-asset-head"><span>文件</span><span>来源阶段</span><span>版本</span><span>状态</span><span /></div>{project.assets.map(asset => <div className="lp-asset-row" key={asset.id}><span><FileText size={15} /><span><strong>{asset.name}</strong><small title={asset.path}>{asset.path}</small></span></span><span>{project.stages.find(item => item.id === asset.stageId)?.title ?? "项目"}</span><span>v{asset.version}<small>{asset.hash.slice(0, 10)}</small></span><span>{asset.confirmed ? "已确认" : "待确认"}</span><span><button className="lp-button" onClick={() => void showAsset(asset.name, asset.path)}>预览</button><button className="lp-icon-button" aria-label={`打开${asset.name}所在位置`} onClick={() => void apiGet(`/api/open?path=${encodeURIComponent(asset.path)}`)}><FolderOpen size={15} /></button></span></div>)}{project.assets.length === 0 && <div className="lp-empty lp-table-empty"><FileText size={20} /><p>还没有导入或交付的文件。</p></div>}</div></section>}

    {tab === "events" && <section className="lp-content-page"><div className="lp-page-title"><span className="lp-kicker">AUDIT TRAIL</span><h1>动态</h1><p>这里只显示后端实际持久化的项目操作。</p></div><div className="lp-event-list">{project.events.map(event => <article key={event.id}><span><History size={14} /></span><div><p>{event.text}</p><time>{new Date(event.createdAt).toLocaleString("zh-CN")}</time></div></article>)}{project.events.length === 0 && <div className="lp-empty"><Clock3 size={20} /><p>暂无项目动态。</p></div>}</div></section>}

    {settingsOpen && <ProjectSettingsDialog project={project} experts={experts} connectors={connectors} busy={busy} onClose={() => setSettingsOpen(false)} onAction={onAction} />}
    <div className="lp-workspace-bottom"><button className="lp-button" onClick={() => void onAction("archive", { archived: !project.archived }).catch(() => {})}><Archive size={14} />{project.archived ? "恢复项目" : "归档项目"}</button></div>
  </main>;
}
