import { randomUUID } from "../../../../src/lib/uuid";
import { loadHistory, setActiveRequirement, rememberRequirement, useProjectHistory, updateRecent } from "./projectHistory";
import { useProjectAuthorization } from "./ProjectAuthorization";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronRight, Circle, Clock3, FileText, FolderKanban, GitBranch, ListChecks, LockKeyhole, MessageSquare, PackageCheck, Pause, Play, Plus, RotateCcw, Search, Settings2, ShieldCheck, Sparkles, Workflow, X } from "lucide-react";
import { demoKey, event, now, outputFor, readProjects, stages, activeStageIds, nextStage, previousStage, uid, version, type DemoProject, type DemoRun } from "./projectDemo";
import "./ProjectPanel.css";
import ArchitectureRepository from "./ArchitectureRepository";
import RequirementsDesk, { type TapdRequirement } from "./RequirementsDesk";
import { apiGet, apiPost } from "../../api/client";
import { useStore } from "../../store/useStore";
import RequirementChat from "./RequirementChat";
import { stageForTapdStatus } from "./requirementStageExpert";

type Tab = "requirements" | "flow" | "tasks" | "artifacts" | "history" | "settings";
const tapdDesignStages = new Set([0, 1, 2, 3]);

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="pw-modal" aria-label={title} onCancel={onClose} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <header><h2>{title}</h2><button className="pw-icon" aria-label="关闭" onClick={onClose}><X size={19} /></button></header>{children}
  </dialog>;
}

function Status({ run }: { run: DemoRun }) {
  if (run.intakeStatus === "pending") return <span className="pw-status is-muted"><i />待确认 · 未启动产研</span>;
  const done = run.stage === stages.length;
  return <span className={`pw-status ${done ? "is-done" : run.paused ? "is-muted" : ""}`}><i />{done ? "已交付" : run.paused ? "已暂停" : [2, 6].includes(run.stage) ? "待人工审核" : stages[run.stage].title}</span>;
}

export default function ProjectPanel({ accountId }: { accountId: string }) {
  const historySelection = useProjectHistory(s => s.selection);
  const overviewRequest = useProjectHistory(s => s.overviewRequest);
  const authorization = useProjectAuthorization();
  useEffect(() => { loadHistory(accountId); }, [accountId]);
  const [projects, setProjects] = useState(readProjects);
  const [projectId, setProjectId] = useState<string | null>(() => readProjects()[0]?.id ?? null);
  const [runId, setRunId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("requirements");
  const [selectedStage, setSelectedStage] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"project" | "requirement" | null>(null);
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [note, setNote] = useState("");
  const [repositoryDirty, setRepositoryDirty] = useState(false);
  const [openingConversation, setOpeningConversation] = useState(false);
  const [uploadField, setUploadField] = useState("custom_field_one");
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [syncingStage, setSyncingStage] = useState<number | null>(null);
  const project = projects.find((p) => p.id === projectId);
  const run = project?.runs.find((r) => r.id === runId) ?? project?.runs[0];
  const stageIndex = selectedStage ?? run?.activeStage ?? Math.min(run?.stage ?? 0, stages.length - 1);
  const stage = stages[stageIndex];
  const current = run?.stage === stageIndex;
  const done = run?.stage === stages.length;

  useEffect(() => { try { localStorage.setItem(demoKey, JSON.stringify(projects)); setStorageError(false); } catch { setStorageError(true); } }, [projects]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 4500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { setUploadField(project?.tapdAttachmentField || "custom_field_one"); }, [project?.id, project?.tapdAttachmentField]);

  useEffect(() => { setTab('requirements'); }, [overviewRequest]);
  const displayedRequirementId = run?.tapdId && run.tapdWorkspaceId && tab !== 'requirements' && tab !== 'settings'
    ? `${run.tapdWorkspaceId}:${run.tapdId}` : null;
  useEffect(() => {
    setActiveRequirement(accountId, displayedRequirementId);
    return () => setActiveRequirement(accountId, null);
  }, [accountId, displayedRequirementId]);

  useEffect(() => {
    const selected = historySelection;
    if (!selected || selected.account !== accountId) return;
    const item = useProjectHistory.getState().items.find(i => i.id === selected.item.id) || selected.item;
    setProjects(all => {
      const existing = all.find(p => p.id === item.project.id);
      return existing ? all.map(p => p.id === existing.id ? { ...p, runs: [item.run, ...p.runs.filter(r => r.id !== item.run.id)] } : p) : [{ ...item.project, runs: [item.run] }, ...all];
    });
    setProjectId(item.project.id); setRunId(item.run.id); setSelectedStage(item.stage); setTab('flow');
  }, [historySelection, accountId]);
  useEffect(() => { authorization.setWorkspace(tab === 'requirements' ? '' : run?.tapdWorkspaceId || ''); }, [run?.tapdWorkspaceId, tab, authorization.setWorkspace]);
  useEffect(() => {
    if (!accountId || !project || !run?.tapdId || !run.tapdWorkspaceId || tab !== 'flow') return;
    const { runs: _runs, ...summary } = project;
    const id = `${run.tapdWorkspaceId}:${run.tapdId}`;
    rememberRequirement(accountId, { id, project: summary, run, stage: stageIndex, visitedAt: Date.now() });
  }, [accountId, project, run, stageIndex, tab]);
  useEffect(() => {
    if (authorization.blocked || tab !== "flow" || !run?.tapdId || !run.tapdWorkspaceId) return;
    let active = true;
    void apiGet<{ requirement: TapdRequirement | null; tasks: DemoRun['tapdTasks']; attachments: DemoRun['tapdAttachments'] }>(`/api/tapd/requirements/${encodeURIComponent(run.tapdWorkspaceId)}/${encodeURIComponent(run.tapdId)}`).then(value => {
      if (!active || !value.requirement) return;
      const req = value.requirement;
      updateRun(r => ({ ...r, title: req.name, description: req.description || r.description, tapdStatus: req.statusLabel, tapdTasks: value.tasks, tapdAttachments: value.attachments, tapdSyncedAt: Date.now() }));
      updateRecent(accountId, `${req.workspaceId}:${req.id}`, { syncedAt: Date.now() });
    }).catch(e => { if (active) setNotice(String(e)); });
    return () => { active = false; };
  }, [authorization.revision, authorization.blocked, tab, run?.tapdId, run?.tapdWorkspaceId]);

  function updateRun(update: (r: DemoRun) => DemoRun) {
    if (!project || !run) return;
    setProjects((all) => all.map((p) => p.id === project.id ? { ...p, runs: p.runs.map((r) => r.id === run.id ? update(r) : r) } : p));
  }
  function openProject(p: DemoProject) { setProjectId(p.id); setRunId(p.runs[0]?.id ?? null); setSelectedStage(null); setTab("requirements"); setNote(""); }
  function enterRun(id: string) { setRunId(id); setSelectedStage(null); setTab("flow"); setNote(""); }
  async function importTapdRequirement(requirement: TapdRequirement) {
    if (!project) return;
    const existing = project.runs.find((item) => item.tapdId === requirement.id && (!item.tapdWorkspaceId || item.tapdWorkspaceId === requirement.workspaceId));
    if (existing) { enterRun(existing.id); return; }
    let context: { spaceId: string; requirement: TapdRequirement | null; tasks: DemoRun["tapdTasks"]; attachments: DemoRun["tapdAttachments"] };
    try {
      context = await apiGet<{ spaceId: string; requirement: TapdRequirement | null; tasks: DemoRun["tapdTasks"]; attachments: DemoRun["tapdAttachments"] }>(`/api/tapd/requirements/${encodeURIComponent(requirement.workspaceId)}/${encodeURIComponent(requirement.id)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法打开 TAPD 需求空间");
      return;
    }
    if (!context.requirement) { setNotice("需求不存在或无权访问"); return; }
    requirement = context.requirement;
    const recommendedStage = stageForTapdStatus(requirement.statusLabel);
    const imported: DemoRun = {
      id: uid(),
      title: requirement.name,
      description: requirement.description || `来自 TAPD「${requirement.workspaceName}」的需求。`,
      clarification: "",
      intakeStatus: "confirmed",
      tapdId: requirement.id,
      tapdWorkspaceId: requirement.workspaceId,
      tapdTasks: context.tasks || [],
      tapdAttachments: context.attachments || [],
      tapdStatus: requirement.statusLabel,
      tapdSyncedAt: Date.now(),
      stage: recommendedStage ?? 0,
      revision: 1,
      paused: false,
      outputs: [],
      events: [event(`已从 TAPD「${requirement.workspaceName}」导入需求；业务状态：${requirement.statusLabel}`)],
    };
    setProjects((all) => all.map((item) => item.id === project.id
      ? { ...item, runs: [imported, ...item.runs] }
      : item));
    enterRun(imported.id);
    setNotice("TAPD 需求已进入产研工作台。");
  }
  async function openRequirementConversation() {
    if (!run?.tapdId || !run.tapdWorkspaceId || openingConversation) return;
    setOpeningConversation(true);
    try {
      const result = await apiPost<{ conversationId: string }>(
        `/api/tapd/requirements/${encodeURIComponent(run.tapdWorkspaceId)}/${encodeURIComponent(run.tapdId)}/conversations`,
        { title: `${run.title} · 需求协作`, requestKey: randomUUID() },
      );
      await useStore.getState().selectConversation(result.conversationId);
      setNotice("已打开该 TAPD 需求的隔离会话，可在输入框中继续协作。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "需求会话打开失败");
    } finally {
      setOpeningConversation(false);
    }
  }
  async function uploadRequirementAsset(file: File) {
    if (!run?.tapdId || !run.tapdWorkspaceId || uploadingAsset) return;
    setUploadingAsset(true);
    try {
      const form = new FormData();
      form.set("customField", uploadField.trim());
      form.set("file", file);
      const response = await fetch(`/api/tapd/requirements/${encodeURIComponent(run.tapdWorkspaceId)}/${encodeURIComponent(run.tapdId)}/attachments`, { method: "POST", body: form });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "TAPD 附件上传失败");
      const context = await apiGet<{ attachments: DemoRun["tapdAttachments"] }>(`/api/tapd/requirements/${encodeURIComponent(run.tapdWorkspaceId)}/${encodeURIComponent(run.tapdId)}`);
      updateRun((currentRun) => ({ ...currentRun, tapdAttachments: context.attachments || [] }));
      setNotice("附件已上传到 TAPD 指定自定义字段。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "TAPD 附件上传失败");
    } finally {
      setUploadingAsset(false);
    }
  }
  async function uploadStageDocument(stageNumber: number, revision: number, content: string) {
    if (!project || !run?.tapdId || !run.tapdWorkspaceId) return;
    const field = project.tapdAttachmentField?.trim() || uploadField.trim();
    if (!field) throw new Error("请先在工作台配置中设置 TAPD 附件字段");
    const form = new FormData();
    form.set("customField", field);
    const safeTitle = run.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
    const filename = `${safeTitle}_${String(activeStageIds.indexOf(stageNumber) + 1).padStart(2, "0")}_${stages[stageNumber].output.replace(/\.md$/i, "")}_r${revision}.md`;
    form.set("file", new File([content], filename, { type: "text/markdown;charset=utf-8" }));
    const response = await fetch(`/api/tapd/requirements/${encodeURIComponent(run.tapdWorkspaceId)}/${encodeURIComponent(run.tapdId)}/attachments`, { method: "POST", body: form });
    const body = await response.json() as { error?: string; uploaded?: Record<string, unknown> };
    if (!response.ok) throw new Error(body.error || "TAPD 设计文档上传失败");
    return body.uploaded;
  }
  async function advance() {
    if (!project || !run || syncingStage !== null || run.intakeStatus === "pending" || run.paused || run.stage >= stages.length) return;
    if (run.stage === 0 && !run.clarification.trim()) { setNotice("请先填写范围与约束，再进入 PRD 阶段。"); return; }
    if (run.stage === 3 && (repositoryDirty || !run.repositoryContext || (!run.repositoryContext.repository && !run.repositoryContext.localPath) || !run.repositoryContext.ref || !run.repositoryContext.scope)) { setNotice("请先保存仓库关联、代码引用和分析范围，再继续研发设计。"); return; }
    const index = run.stage;
    const revision = run.revision;
    const content = outputFor(run, index, project) + (note.trim() ? `\n\n处理意见：${note.trim()}` : "");
    const shouldUpload = Boolean(run.tapdId && run.tapdWorkspaceId && tapdDesignStages.has(index));
    updateRun((r) => ({ ...r, stage: nextStage(index), outputs: [...r.outputs, { stage: index, revision, content, createdAt: now(), tapdSyncStatus: shouldUpload ? "pending" : "local-only" }], events: [event(`${stages[index].title}已${[2, 6].includes(index) ? "人工确认（演示）" : "模拟完成"}${note.trim() ? ` · ${note.trim()}` : ""}${index < 9 ? ` → ${stages[nextStage(index)].title}` : " → 流程归档"}`), ...r.events] }));
    setSelectedStage(null); setNote("");
    if (!shouldUpload) {
      setNotice(index === 9 ? "演示交付已归档，可以查看完整追溯产物。" : `已进入「${stages[nextStage(index)].title}」`);
      return;
    }
    setSyncingStage(index);
    setNotice(`${stages[index].output} 已保存，正在自动上传 TAPD…`);
    try {
      const uploaded = await uploadStageDocument(index, revision, content);
      const attachmentId = String(uploaded?.id || uploaded?.attachment_id || "");
      const context = await apiGet<{ attachments: DemoRun["tapdAttachments"] }>(`/api/tapd/requirements/${encodeURIComponent(run.tapdWorkspaceId!)}/${encodeURIComponent(run.tapdId!)}`);
      updateRun((r) => ({ ...r, tapdAttachments: context.attachments || r.tapdAttachments, outputs: r.outputs.map((output) => output.stage === index && output.revision === revision ? { ...output, tapdSyncStatus: "synced", tapdAttachmentId: attachmentId || undefined, tapdSyncError: undefined } : output), events: [event(`${stages[index].output} 已自动上传到 TAPD`), ...r.events] }));
      setNotice(`${stages[index].output} 已自动上传 TAPD。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "TAPD 上传失败";
      updateRun((r) => ({ ...r, outputs: r.outputs.map((output) => output.stage === index && output.revision === revision ? { ...output, tapdSyncStatus: "failed", tapdSyncError: message } : output), events: [event(`${stages[index].output} 上传 TAPD 失败：${message}`), ...r.events] }));
      setNotice(`设计文档已本地保存；TAPD 上传失败：${message}`);
    } finally {
      setSyncingStage(null);
    }
  }
  function reject(testFailure = false) {
    if (!run || run.paused) return;
    if (!note.trim()) { setNotice(testFailure ? "请填写模拟失败原因，作为开发返修输入。" : "请填写审核意见，作为返修输入。"); return; }
    const target = run.stage === 2 ? 1 : 3;
    updateRun((r) => ({ ...r, stage: target, revision: r.revision + 1, events: [event(`${testFailure ? "测试未通过" : "审核驳回"}：${note.trim()} → 返回${stages[target].title}；旧产物保留，新版本需重新审核`), ...r.events] }));
    setSelectedStage(null); setNote(""); setNotice("已回退到返修阶段，历史记录与产物继续保留。");
  }
  function showArtifact(index: number) {
    const output = run?.outputs.filter((o) => o.stage === index).at(-1);
    if (output) setPreview({ title: stages[index].output, content: output.content });
  }
  function createFromForm(form: HTMLFormElement) {
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const description = String(data.get("description") || "").trim();
    if (!name || !description) return;
    if (modal === "project") {
      const p: DemoProject = { id: uid(), name, description, repo: String(data.get("repo") || "未配置"), tapd: String(data.get("tapd") || "未配置"), runs: [] };
      setProjects((all) => [...all, p]); openProject(p);
    } else if (project) {
      const r: DemoRun = { id: uid(), title: name, description, clarification: "", intakeStatus: "pending", stage: 0, revision: 1, paused: false, outputs: [], events: [event("需求已进入需求池，等待确认；尚未启动产研流程")] };
      setProjects((all) => all.map((p) => p.id === project.id ? { ...p, runs: [...p.runs, r] } : p));
      setRunId(r.id); setSelectedStage(null); setTab("requirements"); setNote("");
    }
    setModal(null);
  }

  if (run?.tapdId && run.tapdWorkspaceId && tab !== "requirements" && tab !== "settings") {
    return <><RequirementChat key={`${run.tapdWorkspaceId}:${run.tapdId}:${stageIndex}`} run={run} initialPanel={useProjectHistory.getState().items.find(i => i.id === `${run.tapdWorkspaceId}:${run.tapdId}`)?.panel} onPanelChange={panel => updateRecent(accountId, `${run.tapdWorkspaceId}:${run.tapdId}`, { panel })} customField={project?.tapdAttachmentField || uploadField} stageIndex={stageIndex} onStage={(index) => { setSelectedStage(index); updateRun((r) => ({ ...r, activeStage: index })); }}
      onBack={() => setTab("requirements")} completing={syncingStage !== null}
      onComplete={async ({ conversationId, expectedStatus, targetStatus }) => {
        if (syncingStage !== null) return;
        const index = stageIndex;
        setSyncingStage(index);
        try {
          const result = await apiPost<{ current: string; currentLabel: string; count: number }>(`/api/conversations/${encodeURIComponent(conversationId)}/requirement-completion`, {
            expectedStatus, targetStatus, customField: project?.tapdAttachmentField || uploadField,
          });
          const next = stageForTapdStatus(result.currentLabel) ?? stageForTapdStatus(result.current) ?? Math.min(nextStage(index), stages.length - 1);
          updateRun(r => ({ ...r, tapdStatus: result.currentLabel, stage: Math.max(r.stage, next), activeStage: next,
            events: [event(`${stages[index].title}：已上传 ${result.count} 个产物，TAPD 已流转至 ${result.currentLabel}`), ...r.events] }));
          setSelectedStage(next);
          setNotice(`已上传 ${result.count} 个产物，TAPD 已流转至「${result.currentLabel}」。`);
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "阶段提交失败，请重试");
        } finally { setSyncingStage(null); }
      }} />{notice && <div className="pw-toast" role="status">{notice}</div>}</>;
  }
  return <section className="pw-root">
    <div className="pw-topline"><span><FolderKanban size={16} /> 需求与产研工作台</span><span className="pw-demo"><i /> TAPD 实时同步 · 本地执行</span></div>
    <div className="pw-scroll">
      <div className="pw-demo-banner">需求列表和业务状态来自 TAPD；产研执行、代码提交与测试结果仍保存在本地工作台。{storageError && <strong>本地存储不可用，刷新后更改可能丢失。</strong>}</div>
      {!project ? <>
        <header className="pw-page-heading"><div><span className="pw-eyebrow">FROM IDEA TO DELIVERY</span><h1>让每个需求，都有交付的路径。</h1><p>连接产品、架构、开发与测试，把协作过程沉淀为可追溯的产物。</p></div><button className="pw-primary" onClick={() => setModal("project")}><Plus size={17} />新建项目</button></header>
        <div className="pw-metrics">{[
          ["项目", projects.length, "独立的代码与协作空间"], ["进行中需求", projects.flatMap((p) => p.runs).filter((r) => r.intakeStatus !== "pending" && r.stage < 10).length, "沿着明确阶段持续推进"], ["待审核", projects.flatMap((p) => p.runs).filter((r) => [2, 6].includes(r.stage)).length, "在关键节点保留人的判断"],
        ].map(([label, value, caption]) => <div key={label}><span>{label}</span><strong>{value}<small>{caption}</small></strong></div>)}</div>
        <div className="pw-section-heading"><h2>我的项目 <small>{projects.length}</small></h2><label className="pw-search"><Search size={16} /><input aria-label="搜索项目" placeholder="搜索项目…" value={search} onChange={(e) => setSearch(e.target.value)} /></label></div>
        <div className="pw-project-grid">{projects.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase())).map((p) => <button className="pw-project-card" key={p.id} onClick={() => openProject(p)}>
          <div className="pw-card-top"><span className="pw-project-symbol"><FolderKanban size={24} /></span><ArrowUpRight size={19} /></div><h2>{p.name}</h2><p>{p.description}</p><div className="pw-repo"><GitBranch size={14} />{p.repo}</div><div className="pw-card-foot"><span>{p.runs.length} 条需求</span><span>{p.runs.filter((r) => [2, 6].includes(r.stage)).length} 项待审核<ChevronRight size={14} /></span></div>
        </button>)}</div>
        {!projects.some((p) => `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase())) && <div className="pw-empty">没有匹配的项目，请尝试其他名称。</div>}
        <div className="pw-guide"><span className="pw-guide-icon"><Workflow size={24} /></span><div><h3>一次需求，一条完整的交付链</h3><p>确认需求 → 产品设计 → 研发设计 → 代码审核 → 测试与交付</p></div><span>8 个阶段 · 2 个人工审核节点</span></div>
      </> : <>
        <header className="pw-page-heading pw-detail-heading"><div><h1>{tab === "settings" ? "项目设置" : "需求总览"}</h1><p>{project.name} · {tab === "settings" ? "管理当前项目的仓库与 TAPD 附件配置。" : "统一查看 TAPD 需求，点击需求进入产研工作台。"}</p></div><button className="pw-secondary" onClick={() => setTab(tab === "settings" ? "requirements" : "settings")}>{tab === "settings" ? <><ArrowRight size={16} />返回需求总览</> : <><Settings2 size={16} />项目设置</>}</button></header>

        {tab === "requirements" ? <RequirementsDesk key={project.id} project={project} onImport={importTapdRequirement} /> : tab === "settings" ? <div className="pw-settings"><div><span className="pw-eyebrow">WORKBENCH CONFIGURATION</span><h2>为每个阶段，安排合适的能力。</h2><p>TAPD 连接由内置连接器统一管理；这里保存产研执行所需的本地配置。</p></div><form onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); const tapdAttachmentField = String(data.get("tapdAttachmentField") || "").trim(); setProjects((all) => all.map((p) => p.id === project.id ? { ...p, repo: String(data.get("repo")).trim(), tapdAttachmentField } : p)); setUploadField(tapdAttachmentField); setNotice("项目设置已保存。"); }}><label>默认代码仓库<input name="repo" required defaultValue={project.repo} key={`repo-${project.id}`} /></label><label>TAPD 产研文档附件字段<input name="tapdAttachmentField" required defaultValue={project.tapdAttachmentField || "custom_field_one"} key={`tapd-field-${project.id}`} placeholder="例如 custom_field_one" /><small>设计文档与测试用例上传到当前需求附件。</small></label><button className="pw-primary" type="submit">保存配置</button></form><div className="pw-role-grid">{["产品专家", "软件架构师", "软件开发专家", "测试专家"].map((role, index) => <div key={role}><span className="pw-avatar">{role.slice(0, 1)}</span><h3>{role}</h3><p>{["澄清需求、编写 PRD", "设计接口、拆解任务", "实现功能、提交代码", "编写用例、覆盖验收"][index]}</p><small>{index === 3 ? "测试专家包 · 本地安装后自动唤起" : "固定市场专家 · 首次使用自动下载"}</small></div>)}</div></div> : <div className="pw-workspace">
          <aside className="pw-requirements"><div className="pw-rail-heading">需求 <small>{project.runs.length}</small></div>{project.runs.map((r) => <button key={r.id} className={`pw-requirement ${r.id === run?.id ? "active" : ""}`} onClick={() => { setRunId(r.id); setSelectedStage(null); setNote(""); }}><small>REQ · {r.id.slice(0, 8).toUpperCase()}</small><strong>{r.title}</strong><Status run={r} /><div className="pw-mini-progress"><i style={{ width: `${r.stage * 10}%` }} /></div></button>)}<button className="pw-add-requirement" onClick={() => setModal("requirement")}><Plus size={15} />登记新需求</button></aside>
          {!run ? <div className="pw-empty"><Workflow size={40} /><h2>从一个真实需求开始</h2><p>用业务原话描述目标，确认后即可进入产品设计与研发阶段。</p><button className="pw-primary" onClick={() => setModal("requirement")}>登记第一条需求<ArrowRight size={16} /></button></div> : run.intakeStatus === "pending" ? <div className="pw-empty"><FileText size={32} /><h2>先确认需求，再进入产研</h2><p>这条需求尚在需求池中，设计、开发与测试尚未启动。</p><button className="pw-primary" onClick={() => setTab("requirements")}>返回需求管理<ArrowRight size={15} /></button></div> : <main className="pw-run">
            <div className="pw-run-heading"><div><span className="pw-eyebrow">REQUIREMENT / {run.id.slice(0, 8).toUpperCase()}</span><h2>{run.title}</h2></div><div className="pw-run-actions"><button className="pw-secondary" disabled={!run.tapdId || openingConversation} onClick={() => void openRequirementConversation()}><MessageSquare size={15} />{openingConversation ? "正在打开…" : "打开需求会话"}</button><Status run={run} /></div></div><div className="pw-business-status"><span>TAPD 需求：{run.tapdId || "未关联"}</span><span>业务状态：{run.tapdStatus || "未获取"}（演示快照）</span><small>产研阶段完成不自动更改 TAPD 状态</small></div>
            {tab === "flow" && <>
              <div className="pw-flow-summary"><span>{done ? "所有阶段已完成" : `当前进度 ${activeStageIds.indexOf(run.stage)} / ${activeStageIds.length}`}<b>{done ? "演示交付归档" : `下一步 · ${stages[run.stage].title}`}</b></span><div className="pw-progress"><i style={{ width: `${(done ? 1 : activeStageIds.indexOf(run.stage) / activeStageIds.length) * 100}%` }} /></div>{!done && <button className="pw-text-button" onClick={() => updateRun((r) => ({ ...r, paused: !r.paused, events: [event(r.paused ? "演示流程已恢复" : "演示流程已暂停"), ...r.events] }))}>{run.paused ? <Play size={14} /> : <Pause size={14} />}{run.paused ? "继续" : "暂停"}</button>}</div>
              <div className="pw-stage-strip" aria-label="交付阶段">{stages.map((s, i) => <button key={s.title} aria-current={stageIndex === i ? "step" : undefined} className={`${stageIndex === i ? "selected" : ""} ${i < run.stage ? "complete" : ""} ${i === run.stage ? "current" : ""}`} onClick={() => { setSelectedStage(i); setNote(""); }}><span>{i < run.stage ? <Check size={14} /> : String(activeStageIds.indexOf(i) + 1).padStart(2, "0")}</span><strong>{s.title}</strong><small>{i < run.stage ? "已完成" : i === run.stage ? run.paused ? "已暂停" : "待处理" : "等待前序"}</small></button>)}</div>
              <div className="pw-stage-layout"><article className="pw-stage-card"><div className="pw-stage-title"><div><span className="pw-eyebrow">STAGE {String(activeStageIds.indexOf(stageIndex) + 1).padStart(2, "0")}</span><h2>{stage.title}</h2></div><span className={`pw-stage-badge ${stageIndex < run.stage ? "complete" : ""}`}>{stageIndex < run.stage ? <CheckCheck size={16} /> : [2, 6].includes(stageIndex) ? <ShieldCheck size={16} /> : <Sparkles size={16} />}{stageIndex < run.stage ? "已完成" : [2, 6].includes(stageIndex) ? "人工节点" : "自动节点 · 演示"}</span></div><p className="pw-stage-description">{stage.description}</p>
                <div className="pw-input-block"><span>本阶段输入</span><strong>{stageIndex === 0 ? run.description : `${stages[previousStage(stageIndex)].output} · 当前有效版本`}</strong>{stageIndex > 0 && <button disabled={!run.outputs.some((o) => o.stage === previousStage(stageIndex))} className="pw-text-button" onClick={() => showArtifact(previousStage(stageIndex))}>查看输入<ArrowUpRight size={13} /></button>}</div>
                {stageIndex === 0 && <label className="pw-field">范围与约束<textarea disabled={!current || run.paused} rows={4} placeholder="例如：面向门店运营；沿用现有技术栈；本期不自动下单。" value={run.clarification} onChange={(e) => { const value = e.target.value; updateRun((r) => ({ ...r, clarification: value })); }} /></label>}
                {stageIndex === 3 && <ArchitectureRepository key={`${run.id}-${run.revision}`} value={run.repositoryContext} defaultRepository={project.repo} locked={run.stage > 3} paused={run.paused} onDirtyChange={setRepositoryDirty} onSave={(repositoryContext) => {
                  updateRun((r) => ({ ...r, repositoryContext, events: [event(`研发设计仓库关联已保存：${repositoryContext.repository || repositoryContext.localPath} @ ${repositoryContext.ref}（尚未读取代码）`), ...r.events] }));
                  setNotice("仓库关联已保存，将作为研发设计的输入。");
                }} onReopen={() => {
                  updateRun((r) => ({ ...r, stage: 3, revision: r.revision + 1, events: [event("重新进入研发设计；历史产物保留，下游开发、审核与测试需重新执行"), ...r.events] }));
                  setSelectedStage(3); setNotice("已返回研发设计，可以修改代码关联。");
                }} />}

                {stageIndex === 7 && <div className="pw-test-grid">{["主流程验收", "异常边界", "权限校验"].map((text, i) => <div key={text}><span>AC-0{i + 1}</span><strong>{text}</strong><small>{run.stage > 7 ? "模拟通过" : "等待模拟执行"}</small></div>)}</div>}
                <h3 className="pw-subtitle">阶段完成条件</h3><ul className="pw-checklist">{stage.checks.map((text) => <li key={text}>{stageIndex < run.stage ? <Check size={15} /> : <Circle size={13} />}<span>{text}</span></li>)}</ul>
                <button className="pw-output-row" disabled={!run.outputs.some((o) => o.stage === stageIndex)} onClick={() => showArtifact(stageIndex)}><FileText size={21} /><span><strong>{stage.output}</strong><small>{run.outputs.some((o) => o.stage === stageIndex) ? "查看最近一次演示产物 · 保留历史版本" : "完成本阶段后生成演示产物"}</small></span><ArrowUpRight size={16} /></button>
                {current && [2, 6, 7].includes(stageIndex) && <label className="pw-field">{stageIndex === 7 ? "测试反馈" : "审核意见"}<textarea rows={3} disabled={run.paused} value={note} onChange={(e) => setNote(e.target.value)} placeholder={stageIndex === 7 ? "模拟失败时必填，例如：AC-02 空值输入未正确提示。" : "通过时可选；驳回时请填写需要修改的具体内容。"} /></label>}
                <footer className="pw-stage-actions">{current ? <><span>{syncingStage === stageIndex ? "设计文档正在自动上传 TAPD" : run.paused ? "流程已暂停，请先恢复" : tapdDesignStages.has(stageIndex) && run.tapdId ? "完成后自动上传设计文档到 TAPD" : [2, 6].includes(stageIndex) ? `确认当前 ${version(run)} 的演示产物` : "仅推进演示数据"}</span><div>{[2, 6, 7].includes(stageIndex) && <button className="pw-secondary" disabled={run.paused || syncingStage !== null} onClick={() => reject(stageIndex === 7)}><RotateCcw size={14} />{stageIndex === 7 ? "模拟失败" : "驳回修改"}</button>}<button className="pw-primary" disabled={run.paused || syncingStage !== null} onClick={() => void advance()}>{syncingStage === stageIndex ? "正在上传…" : stage.action}<ArrowRight size={15} /></button></div></> : <span>{stageIndex < run.stage ? "本阶段已完成，可在产物与记录中回看。" : `需先完成「${stages[run.stage]?.title ?? "前序阶段"}」，才能执行本节点。`}</span>}</footer>
              </article><aside className="pw-context"><div className="pw-owner"><span className="pw-eyebrow">本阶段负责人</span><div><span className="pw-avatar">{stage.role.slice(0, 1)}</span><span><strong>{stage.role}</strong><small>{[2, 6].includes(stageIndex) ? "由你确认后继续" : "预设演示角色"}</small></span></div><p>每个阶段使用独立上下文，只接收已确认的输入产物。</p></div><div className="pw-handoff"><LockKeyhole size={17} /><h3>版本明确，交接有据</h3><p>需求 → 设计 → 代码 → 测试。返修后重新审核，旧产物保留在历史中。</p><span>当前版本 <b>{version(run)}</b></span></div><div className="pw-recent"><h3><Clock3 size={15} />最近流转</h3>{run.events.slice(0, 3).map((e) => <div key={e.id}><i /><p>{e.text}<small>{e.time}</small></p></div>)}</div></aside></div>
              {done && <div className="pw-delivered"><PackageCheck size={29} /><div><h3>这条需求，已走完交付流程。</h3><p>演示已归档。查看每个阶段的产物，回溯从需求到交付的全过程。</p></div><button className="pw-secondary" onClick={() => setTab("artifacts")}>查看交付产物<ArrowRight size={15} /></button></div>}
            </>}
            {tab === "tasks" && <><div className="pw-content-heading"><h3>TAPD 任务</h3><p>任务从当前需求实时读取；工作台执行状态与 TAPD 业务状态分开保存。</p></div>{run.tapdTasks?.length ? <div className="pw-task-list">{run.tapdTasks.map((task) => <div key={task.id}><span className="pw-task-number">T</span><div><small>TAPD · {task.id}</small><h3>{task.name || "未命名任务"}</h3><p>{task.owner || "未分配"} · {task.description || "暂无描述"}</p></div><span className="pw-status">{task.status || "未设置"}</span><ArrowUpRight size={18} /></div>)}</div> : <div className="pw-empty"><ListChecks size={30} /><p>该需求下暂未读取到 TAPD 任务。</p></div>}</>}
            {tab === "artifacts" && <><div className="pw-content-heading"><h3>资产与产物</h3><p>TAPD 附件和工作台产物分开保存；设计阶段确认后自动上传。</p></div>{run.tapdId && <div className="pw-asset-upload"><input aria-label="TAPD 附件自定义字段" value={uploadField} onChange={(event) => setUploadField(event.target.value)} placeholder="例如 custom_field_one" /><label className="pw-secondary">{uploadingAsset ? "正在上传…" : "手动上传到 TAPD"}<input type="file" hidden disabled={uploadingAsset} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void uploadRequirementAsset(file); }} /></label></div>}{run.tapdAttachments?.length ? <div className="pw-artifact-list">{run.tapdAttachments.map((file) => <a key={file.id} href={file.url || undefined} target="_blank" rel="noreferrer"><span className="pw-file-symbol"><FileText size={21} /></span><span><strong>{file.filename || "TAPD 附件"}</strong><small>TAPD 附件 · {file.contentType || "未知类型"} · {file.size ? `${Math.round(file.size / 1024)} KB` : "大小未知"}</small></span><ArrowUpRight size={16} /></a>)}</div> : <div className="pw-empty"><FileText size={30} /><p>该需求暂未读取到 TAPD 附件。</p></div>}{run.outputs.length ? <><div className="pw-content-heading"><h3>工作台产物</h3><p>共 {run.outputs.length} 份本地版本</p></div><div className="pw-artifact-list">{[...run.outputs].reverse().map((o, i) => <button key={`${o.stage}-${o.revision}-${i}`} onClick={() => setPreview({ title: (stages[o.stage]?.output || "历史产物"), content: o.content })}><span className="pw-file-symbol"><FileText size={21} /></span><span><strong>{(stages[o.stage]?.output || "历史产物")}</strong><small>{stages[o.stage]?.role || "历史阶段"} · {o.createdAt}{o.tapdSyncStatus === "synced" ? " · 已上传 TAPD" : o.tapdSyncStatus === "pending" ? " · 正在上传 TAPD" : o.tapdSyncStatus === "failed" ? ` · TAPD 上传失败：${o.tapdSyncError || "可重试"}` : " · 仅本地保存"}</small></span><span className="pw-version">demo-r{o.revision}</span><ArrowUpRight size={16} /></button>)}</div></> : null}</>}
            {tab === "history" && <><div className="pw-content-heading"><h3>流程发生的每一步</h3><p>审核、驳回、暂停和阶段交接均保留记录。本记录仅用于交互演示。</p></div><div className="pw-timeline">{run.events.map((e) => <div key={e.id}><span><MessageSquare size={15} /></span><div><strong>{e.text}</strong><small>{e.time}</small></div></div>)}</div></>}
          </main>}
        </div>}
      </>}
    </div>
    {notice && <div className="pw-toast" role="status">{notice}<button className="pw-icon" aria-label="关闭提示" onClick={() => setNotice("")}><X size={14} /></button></div>}
    {modal && <Modal title={modal === "project" ? "新建项目" : "登记需求"} onClose={() => setModal(null)}><form className="pw-create-form" onSubmit={(e) => { e.preventDefault(); createFromForm(e.currentTarget); }}><p>{modal === "project" ? "为一组持续迭代的需求，建立独立的交付空间。" : "需求先进入待确认列表；确认后才启动产品设计、研发与测试。"}</p><label>{modal === "project" ? "项目名称" : "需求标题"}<input name="name" autoFocus required maxLength={80} placeholder={modal === "project" ? "例如：供应链协作平台" : "例如：增加门店补货提醒"} /></label><label>{modal === "project" ? "项目说明" : "业务需求"}<textarea name="description" required rows={4} maxLength={4000} placeholder="说明业务目标、使用对象和已有约束…" /></label>{modal === "project" && <div className="pw-form-columns"><label>代码仓库标识<input name="repo" placeholder="team/repository（可选）" /></label><label>TAPD 项目名称<input name="tapd" placeholder="仅保存名称，不连接服务" /></label></div>}<footer><button type="button" className="pw-secondary" onClick={() => setModal(null)}>取消</button><button className="pw-primary" type="submit">{modal === "project" ? "创建项目" : "登记到需求池"}<ArrowRight size={15} /></button></footer></form></Modal>}
    {preview && <Modal title={preview.title} onClose={() => setPreview(null)}><div className="pw-document"><span className="pw-demo">演示产物 · Markdown</span><pre>{preview.content}</pre></div><footer className="pw-preview-footer"><button className="pw-secondary" onClick={() => { const url = URL.createObjectURL(new Blob([preview.content], { type: "text/markdown;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = preview.title; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>下载 Markdown</button><button className="pw-primary" onClick={() => setPreview(null)}>完成</button></footer></Modal>}
  </section>;
}
