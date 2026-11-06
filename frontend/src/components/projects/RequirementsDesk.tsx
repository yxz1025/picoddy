import { useProjectAuthorization } from "./ProjectAuthorization";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, ExternalLink, FileText, RefreshCw, Search } from "lucide-react";
import { tapdRecovery, type TapdRecoveryStatus } from "./tapdRecovery";
import { apiGet } from "../../api/client";
import type { DemoProject } from "./projectDemo";

export interface TapdRequirement {
  id: string;
  name: string;
  description: string;
  status: string;
  statusLabel: string;
  owner: string;
  priority: string;
  createdAt: string;
  modifiedAt: string;
  workspaceId: string;
  workspaceName: string;
  url: string;
}

interface TapdRequirementsResponse {
  selectedWorkspaceId: string;
  requirements: TapdRequirement[];
  workspaces: Array<{ id: string; name: string }>;
  statuses: string[];
  failedWorkspaceCount: number;
  syncedAt: string;
  owner: string;
  page: number;
  pageSize: number;
  total: number;
}

export default function RequirementsDesk({ project, onImport }: {
  project: DemoProject;
  onImport: (requirement: TapdRequirement) => void | Promise<void>;
}) {
  const authorization = useProjectAuthorization();
  const [entering, setEntering] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [data, setData] = useState<TapdRequirementsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<ReturnType<typeof tapdRecovery>>(null);

  const requestVersion = useRef(0);
  useEffect(() => () => { requestVersion.current++; }, []);

  async function enter(requirement: TapdRequirement) {
    if (entering) return;
    setEntering(`${requirement.workspaceId}:${requirement.id}`);
    try { await onImport(requirement); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "无法打开需求"); }
    finally { setEntering(null); }
  }

  const load = useCallback(async (refresh = false) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(""); setRecovery(null);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (submittedQuery) params.set("query", submittedQuery);
    if (workspaceId) params.set("workspaceId", workspaceId);
    if (status) params.set("status", status);
    if (refresh) params.set("refresh", "1");
    try {
      const result = await apiGet<TapdRequirementsResponse>(`/api/tapd/requirements?${params}`);
      if (version === requestVersion.current) setData(result);
    } catch (reason) {
      const message = (reason instanceof Error ? reason.message : "TAPD 需求加载失败").replace(/^(?:Error:\s*)?ApiError:\s*/, "");
      const code = (reason as { code?: string })?.code;
      let nextRecovery: ReturnType<typeof tapdRecovery> = null;
      if (['TAPD_NOT_CONFIGURED', 'TAPD_UNAUTHORIZED', 'TAPD_AUTH_EXPIRED'].includes(code || '') || message.includes('暂无可访问的 TAPD 项目')) {
        try { nextRecovery = tapdRecovery(await apiGet<TapdRecoveryStatus>('/api/mcp/builtin/tapd')); } catch { /* Preserve the original failure when status is unavailable. */ }
      }
      if (version === requestVersion.current) { setError(message); setRecovery(nextRecovery);  }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [submittedQuery, page, pageSize, status, workspaceId]);

  useEffect(() => { if (!authorization.blocked) void load(); else { requestVersion.current++; setLoading(false); } }, [load, authorization.blocked, authorization.revision]);

  const localByTapdId = useMemo(
    () => new Map(project.runs.filter((run) => run.tapdId).map((run) => [`${run.tapdWorkspaceId}:${run.tapdId}`, run])),
    [project.runs],
  );
  const requirements = data?.requirements ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return <section className="pw-demand-desk">
    <div className="pw-responsibilities"><div><span>TAPD · 业务管理</span><h3>需求与任务的状态流转</h3><p>需求、负责人及业务状态，从 TAPD 实时读取。</p></div><ArrowRight size={20} /><div><span>工作台 · 产研执行</span><h3>设计、研发与测试</h3><p>承接选中的 TAPD 需求，组织专家、代码、评审与产物。</p></div></div>
    <div className="pw-section-heading"><div><h2>我的需求 <small>{total}</small></h2><p className="pw-demand-caption">仅显示负责人包含当前登录人“{data?.owner || "—"}”的 TAPD 需求。</p></div><button className="pw-secondary" disabled={loading || authorization.blocked} onClick={() => void load(true)}><RefreshCw className={loading ? "is-spinning" : ""} size={15} />刷新需求</button></div>
    <div className="pw-demand-toolbar"><span className="pw-result-summary">第 {Math.min(page, totalPages)} / {totalPages} 页</span><div className="pw-demand-tools"><select disabled={loading} aria-label="筛选 TAPD 项目" value={workspaceId || data?.selectedWorkspaceId || ""} onChange={(event) => { setWorkspaceId(event.target.value); setStatus(""); setPage(1); }}><option value="" disabled>正在加载项目…</option><option value="*">全部 TAPD 项目（较慢）</option>{data?.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select><select disabled={loading} aria-label="筛选需求状态" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">全部状态</option>{data?.statuses.map((item) => <option key={item} value={item}>{item}</option>)}</select><form className="pw-demand-search" onSubmit={event => { event.preventDefault(); if (loading) return; setSubmittedQuery(query.trim()); setPage(1); }}><label className="pw-search"><Search size={15} /><input aria-label="搜索需求" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入需求名称，回车搜索" /></label><button type="submit" className="pw-secondary" disabled={loading || (query.trim() === submittedQuery && page === 1)}>搜索</button></form></div></div>
    {data?.failedWorkspaceCount ? <div className="pw-inline-notice">有 {data.failedWorkspaceCount} 个 TAPD 项目暂时无法读取，其余项目的需求已正常展示。</div> : null}
    {data && <p className="pw-demand-caption">上次同步：{data.syncedAt} {authorization.blocked || error ? "· 当前显示缓存内容" : ""}</p>}
    <div className="pw-demand-table"><table><thead><tr><th>需求</th><th>TAPD 项目</th><th>业务状态</th><th>负责人</th><th>操作</th></tr></thead><tbody>{requirements.map((requirement) => {
      const localRun = localByTapdId.get(`${requirement.workspaceId}:${requirement.id}`);
      return <tr key={`${requirement.workspaceId}-${requirement.id}`}><td><a className="pw-demand-name" href={requirement.url} target="_blank" rel="noreferrer">{requirement.name}<ExternalLink size={12} /></a><small>{requirement.id} · {requirement.priority}</small></td><td>{requirement.workspaceName}<small>{requirement.modifiedAt ? `更新于 ${requirement.modifiedAt}` : requirement.workspaceId}</small></td><td><span className="pw-tapd-status">{requirement.statusLabel}</span><small>{authorization.blocked || error ? "上次同步状态" : "TAPD 同步状态"}</small></td><td>{requirement.owner}</td><td><button className="pw-text-button" disabled={entering !== null || (authorization.blocked && !localRun)} onClick={() => void enter(requirement)}>{entering === `${requirement.workspaceId}:${requirement.id}` ? "正在读取…" : localRun ? "继续产研" : "进入产研"}<ArrowRight size={14} /></button></td></tr>;
    })}</tbody></table>{loading && <div className="pw-empty pw-demand-loading"><RefreshCw className="is-spinning" size={27} /><p>正在从 TAPD 查询当前页需求…</p></div>}{!loading && error && <div className="pw-empty"><FileText size={27} /><h2>{recovery?.title || "暂时无法读取 TAPD 需求"}</h2><p>{recovery ? "请使用页面上方的重新授权入口，完成后在本页恢复。" : error}</p>{recovery ? <span>已加载的需求仍可查看。</span> : <button className="pw-secondary" onClick={() => void load(true)}>重新加载</button>}</div>}{!loading && !error && !requirements.length && <div className="pw-empty"><FileText size={27} /><p>{total ? "当前页没有需求" : "没有查询到由当前登录人负责的 TAPD 需求。"}</p></div>}</div>
    {!loading && !error && total > 0 ? <div className="pw-pagination"><span>共 {total} 条</span><span>每页 20 条</span><button className="pw-secondary" disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} />上一页</button><strong>{page} / {totalPages}</strong><button className="pw-secondary" disabled={loading || page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页<ChevronRight size={15} /></button></div> : null}
    {data?.syncedAt && !loading && !error ? <p className="pw-sync-time">最近同步：{new Date(data.syncedAt).toLocaleString("zh-CN", { hour12: false })}</p> : null}
  </section>;
}
