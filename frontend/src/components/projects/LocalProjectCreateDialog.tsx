import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, FolderOpen, GitBranch, Plus, SlidersHorizontal, Trash2, Users, X } from "lucide-react";
import { localProjectTemplates, type LocalProjectCreate } from "../../../../src/domains/project/shared/workflow";
import type { ExpertSummary } from "../../types/experts";
import { createProjectDraft, projectDraftError } from "./LocalProjectModel";

type McpChoice = { id: string; label: string };

export default function LocalProjectCreateDialog({ templateId, experts, connectors, saving, error, onClose, onCreate, onPickDirectory }: {
  templateId: string;
  experts: ExpertSummary[];
  connectors: McpChoice[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onCreate: (draft: LocalProjectCreate) => Promise<void>;
  onPickDirectory: () => Promise<string | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const stagesPanel = useRef<HTMLDetailsElement>(null);
  const [draft, setDraft] = useState(() => createProjectDraft(templateId));
  const [attempted, setAttempted] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null);
  const selectedTemplate = useMemo(() => localProjectTemplates.find(item => item.id === draft.templateId), [draft.templateId]);
  const assignedCount = draft.stages.filter(stage => stage.expertId).length;

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    const frame = requestAnimationFrame(() => nameInput.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      element?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  const update = <K extends keyof LocalProjectCreate>(key: K, value: LocalProjectCreate[K]) => setDraft(current => ({ ...current, [key]: value }));
  const updateStage = (id: string, patch: Partial<LocalProjectCreate['stages'][number]>) =>
    setDraft(current => ({ ...current, stages: current.stages.map(stage => stage.id === id ? { ...stage, ...patch } : stage) }));
  const applyTemplate = (nextId: string) => {
    const next = createProjectDraft(nextId);
    setDraft(current => ({ ...next, name: current.name, description: current.description, dirPath: current.dirPath, repositories: current.repositories, connectors: current.connectors }));
    setPendingTemplate(null);
  };
  const chooseTemplate = (nextId: string) => {
    if (nextId === draft.templateId) return;
    const original = createProjectDraft(draft.templateId);
    const customized = draft.instructions !== original.instructions || JSON.stringify(draft.stages) !== JSON.stringify(original.stages);
    if (customized) setPendingTemplate(nextId);
    else applyTemplate(nextId);
  };
  const moveStage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draft.stages.length) return;
    const stages = [...draft.stages];
    [stages[index], stages[target]] = [stages[target], stages[index]];
    update("stages", stages);
  };
  const addRepository = (path: string) => {
    const value = path.trim();
    if (!value || draft.repositories?.some(repo => repo.path === value)) return;
    update("repositories", [...(draft.repositories ?? []), { name: value.split(/[\\/]/).filter(Boolean).pop() || "代码仓库", path: value, role: "主仓库" }]);
    setRepoPath("");
  };
  const pickDirectory = async (forRepository: boolean) => {
    setPickerError("");
    try {
      const path = await onPickDirectory();
      if (path) { if (forRepository) addRepository(path); else update("dirPath", path); }
    } catch (cause) { setPickerError(cause instanceof Error ? cause.message : "暂时无法选择目录，请重试。"); }
  };
  const validationError = projectDraftError(draft);

  return <dialog ref={dialog} className="lp-dialog lp-create-dialog lp-create-simple" aria-labelledby="lp-create-title" aria-describedby="lp-create-description" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <form onSubmit={event => {
      event.preventDefault(); setAttempted(true);
      if (validationError) {
        if (draft.stages.some(stage => !stage.title.trim() || !stage.goal.trim()) && stagesPanel.current) stagesPanel.current.open = true;
        return;
      }
      void onCreate({ ...draft, name: draft.name.trim(), description: draft.description.trim(), instructions: draft.instructions?.trim() });
    }}>
      <header><div><h2 id="lp-create-title">新建项目</h2><p id="lp-create-description">说说你想完成什么，其余配置可以稍后完善。</p></div><button type="button" className="lp-icon-button" onClick={onClose} disabled={saving} aria-label="关闭"><X size={18} /></button></header>
      <div className="lp-dialog-body">
        <fieldset className="lp-create-fields" disabled={saving}>
          <label className="lp-field"><span>项目名称<small>{draft.name.length}/40</small></span><input ref={nameInput} maxLength={40} aria-required="true" value={draft.name} onChange={event => update("name", event.target.value)} placeholder="给项目起个名字" aria-invalid={attempted && !draft.name.trim()} /></label>
          <label className="lp-field lp-create-goal"><span>想完成什么</span><textarea aria-required="true" value={draft.description} onChange={event => update("description", event.target.value)} placeholder="例如：为现有网站增加会员功能，从方案、开发到测试交付。" rows={3} aria-invalid={attempted && !draft.description.trim()} /></label>

          <div className="lp-create-template"><div><label htmlFor="lp-project-template">工作模板</label><select id="lp-project-template" value={draft.templateId} onChange={event => chooseTemplate(event.target.value)}>{localProjectTemplates.map(template => <option value={template.id} key={template.id}>{template.name}</option>)}</select></div><p>{selectedTemplate?.description}<span> · {draft.stages.length} 个阶段</span></p></div>
          {pendingTemplate && <div className="lp-template-confirm" role="alert"><p>切换模板会替换你调整过的阶段和补充指令。项目名称、目标与仓库会保留。</p><div><button type="button" className="lp-button" onClick={() => setPendingTemplate(null)}>保留当前配置</button><button type="button" className="lp-button lp-button-primary" onClick={() => applyTemplate(pendingTemplate)}>切换模板</button></div></div>}

          <div className="lp-create-options">
            <details className="lp-create-option">
              <summary><GitBranch size={17} /><span><strong>关联代码仓库</strong><small>{draft.repositories?.length ? `已关联 ${draft.repositories.length} 个仓库` : "可选，也可以创建后再关联"}</small></span><ChevronRight size={15} /></summary>
              <div className="lp-create-option-body">
                {(draft.repositories ?? []).map((repo, index) => <div className="lp-create-repo" key={repo.path}><FolderOpen size={16} /><span><strong>{repo.name}</strong><small title={repo.path}>{repo.path}</small></span><button type="button" className="lp-icon-button" aria-label={`移除${repo.name}`} onClick={() => update("repositories", draft.repositories?.filter((_, item) => item !== index))}><X size={15} /></button></div>)}
                <button type="button" className="lp-button" onClick={() => void pickDirectory(true)}><FolderOpen size={15} />选择本地仓库</button>
                <details className="lp-create-manual-path"><summary>手动输入路径</summary><div><input aria-label="仓库路径" value={repoPath} onChange={event => setRepoPath(event.target.value)} placeholder="本地 Git 目录的绝对路径" /><button type="button" className="lp-button" disabled={!repoPath.trim()} onClick={() => addRepository(repoPath)}>添加</button></div></details>
              </div>
            </details>
            <details ref={stagesPanel} className="lp-create-option">
              <summary><Users size={17} /><span><strong>阶段与专家</strong><small>{assignedCount ? `已安排 ${assignedCount} / ${draft.stages.length} 个阶段的专家` : `${draft.stages.length} 个默认阶段 · 专家可稍后选择`}</small></span><ChevronRight size={15} /></summary>
              <div className="lp-create-option-body"><p className="lp-create-hint">已按阶段安排系统内置专家，也可更换为自己的专家。</p>
                <div className="lp-create-stages">{draft.stages.map((stage, index) => <div className="lp-create-stage" key={stage.id}><span className="lp-create-stage-number">{index + 1}</span><div className="lp-create-stage-fields"><input aria-label={`阶段 ${index + 1} 名称`} value={stage.title} onChange={event => updateStage(stage.id, { title: event.target.value })} /><select aria-label={`${stage.title}的专家`} value={stage.expertId} onChange={event => { const expert = experts.find(item => item.id === event.target.value); updateStage(stage.id, { expertId: expert?.id || "", expertName: expert?.name || selectedTemplate?.stages.find(item => item.id === stage.id)?.role || "项目专家" }); }}><option value="">稍后选择专家</option>{experts.filter(expert => expert.available).map(expert => <option value={expert.id} key={expert.id}>{expert.name}{expert.catalogSource === "builtin" ? " · 内置" : ""}</option>)}</select><details><summary>阶段目标</summary><textarea aria-label={`${stage.title}的目标`} rows={2} value={stage.goal} onChange={event => updateStage(stage.id, { goal: event.target.value })} /></details></div><div className="lp-create-stage-actions"><button type="button" className="lp-icon-button" aria-label={`上移${stage.title}`} disabled={index === 0} onClick={() => moveStage(index, -1)}><ArrowUp size={14} /></button><button type="button" className="lp-icon-button" aria-label={`下移${stage.title}`} disabled={index === draft.stages.length - 1} onClick={() => moveStage(index, 1)}><ArrowDown size={14} /></button><button type="button" className="lp-icon-button" aria-label={`删除${stage.title}`} disabled={draft.stages.length === 1} onClick={() => update("stages", draft.stages.filter(item => item.id !== stage.id))}><Trash2 size={14} /></button></div></div>)}</div>
                <button type="button" className="lp-add-row" onClick={() => update("stages", [...draft.stages, { id: `stage-${crypto.randomUUID()}`, title: "新阶段", goal: "完成本阶段工作并保存成果供审核。", expertId: "", expertName: "项目专家" }])}><Plus size={14} />添加阶段</button>
              </div>
            </details>
            <details className="lp-create-option">
              <summary><SlidersHorizontal size={17} /><span><strong>更多设置</strong><small>保存位置、补充指令与连接器</small></span><ChevronRight size={15} /></summary>
              <div className="lp-create-option-body"><label className="lp-field"><span>项目保存位置<small>默认自动创建</small></span><div className="lp-input-action"><input value={draft.dirPath ?? ""} onChange={event => update("dirPath", event.target.value)} placeholder="由应用为此项目创建本地目录" /><button type="button" className="lp-button" onClick={() => void pickDirectory(false)}><FolderOpen size={14} />选择</button></div></label><label className="lp-field"><span>补充指令<small>选填</small></span><textarea value={draft.instructions ?? ""} onChange={event => update("instructions", event.target.value)} rows={3} placeholder="补充所有阶段需要遵循的要求" /></label><div className="lp-create-connectors"><h3>连接器<span>选填</span></h3>{connectors.length ? <div className="lp-choice-grid">{connectors.map(connector => <label key={connector.id}><input type="checkbox" checked={draft.connectors?.includes(connector.id)} onChange={event => update("connectors", event.target.checked ? [...(draft.connectors ?? []), connector.id] : draft.connectors?.filter(id => id !== connector.id))} /><span><strong>{connector.label}</strong></span></label>)}</div> : <p className="lp-create-hint">还没有配置连接器，可在创建后按需添加。</p>}</div></div>
            </details>
          </div>
        </fieldset>
        {pickerError && <p className="lp-form-error" role="alert">{pickerError}</p>}
        {attempted && validationError && <p className="lp-form-error" role="alert">{validationError}</p>}
        {error && <p className="lp-form-error" role="alert">{error}</p>}
      </div>
      <footer><div><button type="button" className="lp-button" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="lp-button lp-button-primary" disabled={saving}>{saving ? "正在创建…" : "创建项目"}</button></div></footer>
    </form>
  </dialog>;
}
