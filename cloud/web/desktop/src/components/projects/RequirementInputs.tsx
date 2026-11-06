import { useEffect, useState } from "react";
import { GitBranch, Laptop } from "lucide-react";
import { apiGet, apiPost, pickDirectory } from "../../api/client";
export interface Repository { id: string; name: string; roles: string[]; path: string; branch: string; commit: string; dirty: boolean; scope: string[] }
export interface InputAsset { id: string; name: string; hash: string; path: string; stage: number }
export interface InputSelection { repositories: string[]; assets: Array<{ id: string; hash: string }>; discussionOnly: boolean }
export interface RequirementInputs { repositories: Repository[]; assets: InputAsset[]; selection: InputSelection }
export function useRequirementInputs(base: string, stageKey: string, refreshToken: boolean) {
  const [data, setData] = useState<RequirementInputs | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function refresh() { setData(await apiGet(`${base}/inputs?stageKey=${encodeURIComponent(stageKey)}`)); }
  useEffect(() => { let active = true; void apiGet<RequirementInputs>(`${base}/inputs?stageKey=${encodeURIComponent(stageKey)}`).then(value => { if (active) { setData(value); setError(""); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [base, stageKey, refreshToken]);
  async function mutate(body: object) {
    setSaving(true); setError("");
    try { setData(await apiPost(`${base}/inputs`, { ...body, stageKey })); return true; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { setSaving(false); }
  }
  return { data, saving, error, refresh, mutate };
}
export function RepositoryPanel({ data, disabled, mutate, openEditor }: { data: RequirementInputs | null; disabled: boolean; mutate: (body: object) => Promise<boolean>; openEditor: (r?: Repository) => void }) {
  return <><h3>本需求的代码仓库</h3><button className="rq-button" disabled={disabled} onClick={() => openEditor()}>＋ 关联代码仓库</button><p>支持多个前端、后端与公共库。勾选后专家按需读取源码，不复制整个仓库。</p>{data?.repositories.map(r => <article className="rq-asset" key={r.id}><label><input type="checkbox" disabled={disabled || data.selection.discussionOnly} checked={data.selection.repositories.includes(r.id)} onChange={e => void mutate({ action: "select", selection: { ...data.selection, repositories: e.target.checked ? [...data.selection.repositories, r.id] : data.selection.repositories.filter(id => id !== r.id) } })} /> {r.roles.join(" / ")} · {r.name}</label><small>{r.path}</small><small className="rq-repository-meta" title="最近一次校验结果；发送时重新校验"><span><Laptop size={14} aria-hidden="true" />本地</span><span><GitBranch size={14} aria-hidden="true" />{r.branch === "HEAD" ? "分离 HEAD" : r.branch || "分支未校验"}</span><code>{r.commit.slice(0, 10)}</code></small><small>范围：{r.scope.join("、")}</small><small>{r.dirty ? "上次校验：有未提交修改" : "上次校验：工作区干净"}；发送时重新校验</small><button disabled={disabled} onClick={() => openEditor(r)}>编辑 / 重新校验</button> <button disabled={disabled} onClick={() => { if (window.confirm(`解除 ${r.name} 的需求关联？磁盘文件和历史输入将保留。`)) void mutate({ action: "removeRepository", repositoryId: r.id }); }}>解除关联</button></article>)}{data?.repositories.length === 0 && <p>尚未关联仓库。请选择已有本地 Git 目录；远程仓库请先克隆到执行 Agent 的机器。</p>}<label className="rq-discussion"><input type="checkbox" disabled={disabled || !data} checked={data?.selection.discussionOnly || false} onChange={e => data && void mutate({ action: "select", selection: { ...data.selection, discussionOnly: e.target.checked } })} /> 仅讨论方案，本轮不读取源码</label></>;
}
export function AssetSelection({ data, disabled, mutate }: { data: RequirementInputs | null; disabled: boolean; mutate: (body: object) => Promise<boolean> }) {
  if (!data) return null;
  return <><h3>本阶段引用版本</h3>{data.assets.map(a => { const ref = data.selection.assets.find(r => r.id === a.id); return <article className="rq-asset" key={a.id}><label><input type="checkbox" disabled={disabled} checked={!!ref} onChange={e => void mutate({ action: "select", selection: { ...data.selection, assets: e.target.checked ? [...data.selection.assets, { id: a.id, hash: a.hash }] : data.selection.assets.filter(r => r.id !== a.id) } })} /> {a.name}</label><small>引用版本：{(ref?.hash || a.hash).slice(0, 10)}</small>{ref && ref.hash !== a.hash && <button disabled={disabled} onClick={() => void mutate({ action: "select", selection: { ...data.selection, assets: data.selection.assets.map(r => r.id === a.id ? { id: a.id, hash: a.hash } : r) } })}>使用已提交的新版本</button>}</article>; })}</>;
}
export function RepositoryEditor({ repo, disabled, save, close }: { repo?: Repository; disabled: boolean; save: (r: object) => Promise<boolean>; close: () => void }) {
  const [name, setName] = useState(repo?.name || ""); const [path, setPath] = useState(repo?.path || "");
  const [roles, setRoles] = useState(repo?.roles || ["前端"]); const [scope, setScope] = useState(repo?.scope.join("\n") || ".");
  const [pickerError, setPickerError] = useState("");
  return <div className="rq-editor-backdrop"><form className="rq-editor" role="dialog" aria-modal="true" aria-label="关联代码仓库" onSubmit={e => { e.preventDefault(); void save({ id: repo?.id, name, path, roles, scope: scope.split(/\n/).map(s => s.trim()).filter(Boolean) }).then(ok => { if (ok) close(); }); }}><h3>{repo ? "编辑仓库关联" : "关联代码仓库"}</h3><label>仓库名称<input autoFocus required value={name} disabled={disabled} onChange={e => setName(e.target.value)} /></label><label>本地 Git 根目录<input required value={path} disabled={disabled} onChange={e => setPath(e.target.value)} /></label><button type="button" disabled={disabled} onClick={() => void pickDirectory().then(r => { if (r.path) { setPath(r.path); if (!name) setName(r.name || "代码仓库"); } }).catch(e => setPickerError(e.message))}>选择本地目录</button><fieldset disabled={disabled}><legend>用途（可多选）</legend>{["前端", "后端", "公共库", "其他"].map(role => <label key={role}><input type="checkbox" checked={roles.includes(role)} onChange={e => setRoles(e.target.checked ? [...roles, role] : roles.filter(r => r !== role))} />{role}</label>)}</fieldset><label>分析范围（每行一个相对目录或文件）<textarea required rows={3} value={scope} disabled={disabled} onChange={e => setScope(e.target.value)} /></label><p>使用当前检出的分支，不自动切换或覆盖本地修改。每轮最多 5000 个文件 / 32MB，建议选择与需求有关的范围。</p>{pickerError && <p role="alert">{pickerError}</p>}<footer><button type="button" disabled={disabled} onClick={close}>取消</button><button disabled={disabled || !roles.length} type="submit">{disabled ? "正在校验…" : "校验并关联"}</button></footer></form></div>;
}
