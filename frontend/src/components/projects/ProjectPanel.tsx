import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import type { LocalProject, LocalProjectCreate } from "../../../../src/domains/project/shared/workflow";
import { apiGet, apiPost, pickDirectory } from "../../api/client";
import { useSkillStore } from "../../store/useSkillStore";
import { demoKey, type DemoProject } from "./projectDemo";
import LocalProjectCreateDialog from "./LocalProjectCreateDialog";
import LocalProjectHome from "./LocalProjectHome";
import { type LocalProjectFilter } from "./LocalProjectModel";
import LocalProjectWorkspace, { type LocalProjectActionResult } from "./LocalProjectWorkspace";
import "./LocalProjectPanel.css";

type ProjectOpenEvent = CustomEvent<{ projectId?: string }>;

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}

export default function ProjectPanel({ accountId }: { accountId: string }) {
  const allExperts = useSkillStore(state => state.experts);
  const installedExperts = useMemo(() => allExperts.filter(expert => expert.catalogSource === "builtin" || expert.catalogSource === "installed"), [allExperts]);
  const installedExpertsLoading = useSkillStore(state => state.installedExpertsLoading);
  const catalogError = useSkillStore(state => state.expertsError);
  const installedError = useSkillStore(state => state.installedExpertsError);
  const expertsError = catalogError || installedError;
  const mcpConfig = useSkillStore(state => state.mcpConfig);
  const mcpError = useSkillStore(state => state.mcpEnterpriseError);
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [selected, setSelected] = useState<LocalProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<LocalProjectFilter>("all");
  const [query, setQuery] = useState("");
  const [createTemplate, setCreateTemplate] = useState<string | null>(null);
  const [settingsRequested, setSettingsRequested] = useState(false);
  const [legacyProjects] = useState<DemoProject[]>(() => {
    try {
      const raw = localStorage.getItem(demoKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      const valid = Array.isArray(parsed) && parsed.length > 0 && parsed.every(item => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as { id?: unknown; name?: unknown; description?: unknown; runs?: unknown };
        return typeof candidate.id === "string" && typeof candidate.name === "string" && typeof candidate.description === "string" && Array.isArray(candidate.runs);
      });
      return valid ? parsed as DemoProject[] : [];
    }
    catch { return []; }
  });

  const connectors = useMemo(() => Object.entries(mcpConfig?.mcpServers ?? {})
    .filter(([, config]) => !config.disabled)
    .map(([id, config]) => ({ id, label: config.displayName || id })), [mcpConfig]);

  const loadProjects = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const value = await apiGet<LocalProject[] | { projects: LocalProject[] }>("/api/local-projects");
      const list = Array.isArray(value) ? value : value.projects;
      setProjects(list);
      setSelected(current => current ? list.find(item => item.id === current.id) ?? current : null);
    } catch (cause) { setError(errorMessage(cause, "项目列表读取失败")); }
    finally { setLoading(false); }
  }, []);

  const openProject = useCallback(async (projectOrId: LocalProject | string) => {
    setMutationError("");
    const projectId = typeof projectOrId === 'string' ? projectOrId : projectOrId.id;
    try {
      const project = await apiGet<LocalProject>(`/api/local-projects/${encodeURIComponent(projectId)}`);
      setProjects(current => [project, ...current.filter(item => item.id !== project.id)]);
      setSelected(project);
    } catch (cause) { setMutationError(errorMessage(cause, "项目读取失败")); }
  }, []);

  const refreshProject = useCallback(async (id: string) => {
    try {
      const project = await apiGet<LocalProject>(`/api/local-projects/${encodeURIComponent(id)}?refresh=1`);
      setProjects(current => [project, ...current.filter(item => item.id !== project.id)]);
      setSelected(current => current?.id === project.id ? project : current);
    } catch (cause) { setMutationError(errorMessage(cause, "项目资产刷新失败")); }
  }, []);

  useEffect(() => {
    setProjects([]); setSelected(null); setFilter("all"); setQuery("");
    void Promise.all([
      loadProjects(),
      useSkillStore.getState().loadInstalledExperts().then(() => useSkillStore.getState().loadExperts()),
      useSkillStore.getState().loadMcp(),
    ]).then(() => {
      const key = `picoddy-local-project-open:${accountId}`;
      const projectId = sessionStorage.getItem(key);
      if (projectId) { sessionStorage.removeItem(key); void openProject(projectId); }
    });
  }, [accountId, loadProjects, openProject]);

  useEffect(() => {
    const key = `picoddy-local-project-open:${accountId}`;
    const listener = (event: Event) => {
      const projectId = (event as ProjectOpenEvent).detail?.projectId;
      if (!projectId) return;
      sessionStorage.removeItem(key);
      void openProject(projectId);
    };
    window.addEventListener("local-project-open", listener);
    return () => window.removeEventListener("local-project-open", listener);
  }, [accountId, openProject]);

  const publishUpdate = () => window.dispatchEvent(new Event("local-projects-updated"));
  const storeProject = (project: LocalProject) => {
    setProjects(current => [project, ...current.filter(item => item.id !== project.id)]);
    setSelected(current => current?.id === project.id ? project : current);
    publishUpdate();
  };

  const action = async (actionName: string, payload: Record<string, unknown> = {}): Promise<LocalProjectActionResult> => {
    if (!selected) throw new Error("尚未选择项目");
    setBusy(true); setMutationError("");
    try {
      const value = await apiPost<LocalProjectActionResult>(`/api/local-projects/${encodeURIComponent(selected.id)}`, { action: actionName, ...payload });
      storeProject("project" in value ? value.project : value);
      return value;
    } catch (cause) {
      const message = errorMessage(cause, "项目操作失败");
      setMutationError(message);
      throw cause;
    } finally { setBusy(false); }
  };

  const createProject = async (draft: LocalProjectCreate) => {
    setBusy(true); setMutationError("");
    try {
      const project = await apiPost<LocalProject>("/api/local-projects", draft);
      storeProject(project);
      setCreateTemplate(null);
      setSelected(project);
    } catch (cause) { setMutationError(errorMessage(cause, "项目创建失败")); }
    finally { setBusy(false); }
  };

  const archiveFromHome = async (project: LocalProject) => {
    setBusy(true); setMutationError("");
    try {
      const next = await apiPost<LocalProject>(`/api/local-projects/${encodeURIComponent(project.id)}`, { action: "archive", archived: !project.archived });
      setProjects(current => [next, ...current.filter(item => item.id !== next.id)]);
      publishUpdate();
    } catch (cause) { setMutationError(errorMessage(cause, "项目归档失败")); }
    finally { setBusy(false); }
  };

  if (loading && projects.length === 0) return <main className="lp-root"><div className="lp-state"><RefreshCw className="lp-spin" size={22} /><h2>正在读取本地项目</h2><p>不会连接外部需求系统或启动任何阶段。</p></div></main>;
  if (error && projects.length === 0) return <main className="lp-root"><div className="lp-state"><AlertCircle size={22} /><h2>无法读取项目</h2><p>{error}</p><button className="lp-button lp-button-primary" onClick={() => void loadProjects()}><RefreshCw size={14} />重试</button></div></main>;

  return <div className="lp-root">
    {selected ? <LocalProjectWorkspace project={selected} experts={installedExperts} connectors={connectors} busy={busy} error={mutationError} initialSettingsOpen={settingsRequested} onBack={() => { setSelected(null); setSettingsRequested(false); setMutationError(""); }} onAction={action} onRefresh={async () => { await refreshProject(selected.id); }} /> : <LocalProjectHome projects={projects} legacyProjects={legacyProjects} filter={filter} query={query} onFilter={setFilter} onQuery={setQuery} onCreate={template => { setMutationError(""); setCreateTemplate(template ?? "development"); }} onOpen={project => { setSettingsRequested(false); void openProject(project); }} onSettings={project => { setSettingsRequested(true); void openProject(project); }} onArchive={project => void archiveFromHome(project)} />}
    {!selected && mutationError && <div className="lp-toast" role="alert">{mutationError}<button className="lp-icon-button" aria-label="关闭提示" onClick={() => setMutationError("")}><span aria-hidden="true">×</span></button></div>}
    {!selected && (expertsError || mcpError) && <div className="lp-passive-warning">{expertsError || mcpError}{installedExpertsLoading ? " · 正在重试" : ""}</div>}
    {createTemplate && <LocalProjectCreateDialog templateId={createTemplate} experts={installedExperts} connectors={connectors} saving={busy} error={mutationError} onClose={() => { setCreateTemplate(null); setMutationError(""); }} onCreate={createProject} onPickDirectory={async () => { const result = await pickDirectory(); return result.cancelled ? null : result.path; }} />}
  </div>;
}
