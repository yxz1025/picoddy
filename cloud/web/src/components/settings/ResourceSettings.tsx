import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Bot, Brain, ChartNoAxesColumn, Clock3, Cpu, FolderKanban, KeyRound, Pencil, PlugZap, Plus, Save, Trash2 } from "lucide-react";

import { api, errorMessage } from "../../api/client";
import type { Automation, Connector, Expert, Memory, Model, Workspace, SettingsSection, Skill, Usage } from "../../types";
import { Button, Field, Spinner, StateBlock } from "../ui";

interface ResourceState<T> {
  data: T;
  loading: boolean;
  error: string | null;
  reload: () => Promise<unknown>;
}

interface Props {
  section: SettingsSection;
  models: ResourceState<Model[]>;
  connectors: ResourceState<Connector[]>;
  experts: ResourceState<Expert[]>;
  workspaces: ResourceState<Workspace[]>;
  skills: Skill[];
  memories: ResourceState<Memory[]>;
  automations: ResourceState<Automation[]>;
  usage: ResourceState<Usage>;
  notify: (message: string) => void;
}

export function ResourceSettings(props: Props) {
  if (props.section === "models") return <ModelSettings resource={props.models} notify={props.notify} />;
  if (props.section === "connectors") return <ConnectorSettings resource={props.connectors} notify={props.notify} />;
  if (props.section === "experts") return <ExpertSettings resource={props.experts} skills={props.skills} notify={props.notify} />;
  if (props.section === "workspaces") return <WorkspaceSettings resource={props.workspaces} notify={props.notify} />;
  if (props.section === "memories") return <MemorySettings resource={props.memories} workspaces={props.workspaces.data} notify={props.notify} />;
  if (props.section === "automations") return <AutomationSettings resource={props.automations} skills={props.skills} connectors={props.connectors.data} models={props.models.data} notify={props.notify} />;
  return <UsageSettings resource={props.usage} />;
}

function SettingsHeader({ eyebrow, title, detail, icon }: { eyebrow: string; title: string; detail: string; icon: ReactNode }) {
  return <div className="settings-panel__heading"><div><span className="eyebrow">{eyebrow}</span><h3>{icon}{title}</h3><p>{detail}</p></div></div>;
}

function ResourceFeedback({ loading, error, empty, emptyText }: { loading: boolean; error: string | null; empty: boolean; emptyText: string }) {
  if (loading) return <Spinner label="读取配置" />;
  if (error) return <StateBlock kind="error" title="配置读取失败" detail={error} />;
  if (empty) return <StateBlock kind="empty" title={emptyText} detail="在右侧表单创建第一项配置" />;
  return null;
}

function EntityList<T extends { id: string }>({ items, selectedId, title, subtitle, onSelect }: { items: T[]; selectedId?: string; title: (item: T) => string; subtitle: (item: T) => string; onSelect: (item: T) => void }) {
  return <div className="entity-list">{items.map((item) => <button key={item.id} className={selectedId === item.id ? "is-active" : ""} onClick={() => onSelect(item)}><span><strong>{title(item)}</strong><small>{subtitle(item)}</small></span><Pencil size={14} /></button>)}</div>;
}

function FormActions({ editing, busy, onReset, onDelete }: { editing: boolean; busy: boolean; onReset: () => void; onDelete?: () => void }) {
  return <div className="form-actions">{editing && onDelete ? <Button type="button" variant="danger" onClick={onDelete} disabled={busy}><Trash2 size={15} /> 删除</Button> : null}<span /><Button type="button" variant="quiet" onClick={onReset}>清空</Button><Button type="submit" variant="primary" disabled={busy}>{editing ? <><Save size={15} /> 保存修改</> : <><Plus size={15} /> 创建</>}</Button></div>;
}

async function removeResource(path: string, name: string, reload: () => Promise<unknown>, notify: (message: string) => void) {
  if (!window.confirm(`删除“${name}”？此操作无法撤销。`)) return false;
  await api.delete(path);
  await reload();
  notify("已删除");
  return true;
}

function ModelSettings({ resource, notify }: { resource: ResourceState<Model[]>; notify: (message: string) => void }) {
  const empty = { name: "", provider: "", model: "", baseUrl: "", apiKey: "" };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<Model | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function reset() { setEditing(null); setForm(empty); setError(null); }
  function select(item: Model) { setEditing(item); setForm({ name: item.name, provider: item.provider, model: item.model, baseUrl: item.baseUrl ?? "", apiKey: "" }); setError(null); }
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { if (form.baseUrl.trim() && !form.baseUrl.trim().startsWith("https://")) throw new Error("Base URL 必须使用 HTTPS，并由服务端允许列表校验"); const payload = { name: form.name.trim(), provider: form.provider.trim(), model: form.model.trim(), baseUrl: form.baseUrl.trim(), ...(form.apiKey ? { apiKey: form.apiKey } : {}) }; if (editing) await api.patch(`/api/models/${editing.id}`, payload); else await api.post("/api/models", payload); await resource.reload(); notify(editing ? "模型配置已更新" : "模型已创建"); reset(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  async function remove() { if (!editing) return; setBusy(true); try { if (await removeResource(`/api/models/${editing.id}`, editing.name, resource.reload, notify)) reset(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return (
    <div className="settings-panel">
      <SettingsHeader eyebrow="MODEL PROVIDERS" title="模型" detail="支持 OpenAI、Anthropic、Google、DeepSeek、Moonshot 与 Qwen。API Key 只写，Base URL 仅接受服务端允许列表内的 HTTPS 地址。" icon={<Cpu size={20} />} />
      <div className="settings-editor-grid">
        <div>
          <ResourceFeedback loading={resource.loading} error={resource.error} empty={!resource.data.length} emptyText="还没有模型" />
          <EntityList items={resource.data} selectedId={editing?.id} title={(item) => item.name} subtitle={(item) => `${item.provider} · ${item.model}`} onSelect={select} />
        </div>
        <form className="resource-form" onSubmit={submit}>
          <h4>{editing ? "编辑模型" : "添加模型"}</h4>
          <Field label="显示名称"><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：生产 Claude" /></Field>
          <div className="field-row">
            <Field label="Provider"><select required value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })}><option value="">请选择</option>{["openai", "anthropic", "google", "deepseek", "moonshot", "qwen"].map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></Field>
            <Field label="模型 ID"><input required value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="模型标识" /></Field>
          </div>
          <Field label="Base URL（可选）" hint="必须为服务端允许列表内的 HTTPS 地址"><input type="url" pattern="https://.*" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://api.example.com" /></Field>
          <Field label="API Key" hint={editing?.apiKeyConfigured ? "已配置；留空将保留现有密钥" : "保存后不会再次显示密钥内容"}><div className="input-with-icon"><KeyRound size={15} /><input required={!editing || !editing.apiKeyConfigured} type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} autoComplete="new-password" placeholder={editing?.apiKeyConfigured ? "••••••••（已配置）" : "输入密钥"} /></div></Field>
          {error ? <p className="form-error">{error}</p> : null}
          <FormActions editing={Boolean(editing)} busy={busy} onReset={reset} onDelete={() => void remove()} />
        </form>
      </div>
    </div>
  );
}

function parseSecretLines(value: string): Record<string, string> {
  return Object.fromEntries(value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const index = line.indexOf("="); if (index < 1) throw new Error(`“${line}”应使用 KEY=VALUE 格式`); return [line.slice(0, index).trim(), line.slice(index + 1)]; }));
}

function ConnectorSettings({ resource, notify }: { resource: ResourceState<Connector[]>; notify: (message: string) => void }) {
  const initial = { name: "", transport: "stdio" as "stdio" | "http", command: "", args: "", url: "", env: "", headers: "" };
  const [form, setForm] = useState(initial); const [editing, setEditing] = useState<Connector | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  function reset() { setEditing(null); setForm(initial); setError(null); }
  function select(item: Connector) { setEditing(item); setForm({ name: item.name, transport: item.transport, command: item.command ?? "", args: (item.args ?? []).join("\n"), url: item.url ?? "", env: "", headers: "" }); setError(null); }
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { const payload = { name: form.name.trim(), transport: form.transport, ...(form.transport === "stdio" ? { command: form.command.trim(), args: form.args.split("\n").map((v) => v.trim()).filter(Boolean) } : { url: form.url.trim() }), ...(form.env.trim() ? { env: parseSecretLines(form.env) } : editing ? {} : { env: {} }), ...(form.headers.trim() ? { headers: parseSecretLines(form.headers) } : editing ? {} : { headers: {} }) }; if (editing) await api.patch(`/api/connectors/${editing.id}`, payload); else await api.post("/api/connectors", payload); await resource.reload(); notify(editing ? "MCP 连接已更新" : "MCP 连接已创建"); reset(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  async function remove() { if (!editing) return; setBusy(true); try { if (await removeResource(`/api/connectors/${editing.id}`, editing.name, resource.reload, notify)) reset(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <div className="settings-panel"><SettingsHeader eyebrow="MODEL CONTEXT PROTOCOL" title="MCP 连接" detail="配置个人 stdio 或 HTTP 连接；密钥字段加密保存且不会回显。" icon={<PlugZap size={20} />} /><div className="settings-editor-grid"><div><ResourceFeedback loading={resource.loading} error={resource.error} empty={!resource.data.length} emptyText="还没有 MCP 连接" /><EntityList items={resource.data} selectedId={editing?.id} title={(item) => item.name} subtitle={(item) => item.transport === "stdio" ? item.command || "stdio" : item.url || "HTTP"} onSelect={select} /></div><form className="resource-form" onSubmit={submit}><h4>{editing ? "编辑连接" : "添加连接"}</h4><Field label="名称"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="传输方式"><select value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value as "stdio" | "http" })}><option value="stdio">stdio</option><option value="http">HTTP</option></select></Field>{form.transport === "stdio" ? <><Field label="命令"><input required value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="npx" /></Field><Field label="参数" hint="每行一个参数"><textarea rows={3} value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} placeholder={"-y\n@scope/server"} /></Field><Field label="环境变量" hint={editing?.envConfigured ? "已配置；留空保留现有值。每行 KEY=VALUE" : "每行 KEY=VALUE"}><textarea rows={3} value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value })} /></Field></> : <><Field label="服务 URL"><input required type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field><Field label="请求头" hint={editing?.headersConfigured ? "已配置；留空保留现有值。每行 KEY=VALUE" : "每行 KEY=VALUE"}><textarea rows={3} value={form.headers} onChange={(e) => setForm({ ...form, headers: e.target.value })} /></Field></>}{error ? <p className="form-error">{error}</p> : null}<FormActions editing={Boolean(editing)} busy={busy} onReset={reset} onDelete={() => void remove()} /></form></div></div>;
}

function IdChoices({ items, value, onChange }: { items: Array<{ id: string; name: string }>; value: string[]; onChange: (next: string[]) => void }) {
  return <div className="choice-grid">{items.length ? items.map((item) => <label key={item.id}><input type="checkbox" checked={value.includes(item.id)} onChange={() => onChange(value.includes(item.id) ? value.filter((id) => id !== item.id) : [...value, item.id])} /> {item.name}</label>) : <span className="empty-line">暂无可选项</span>}</div>;
}

function ExpertSettings({ resource, skills, notify }: { resource: ResourceState<Expert[]>; skills: Skill[]; notify: (message: string) => void }) {
  const initial = { name: "", prompt: "", skillIds: [] as string[] }; const [form, setForm] = useState(initial); const [editing, setEditing] = useState<Expert | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  function reset() { setEditing(null); setForm(initial); setError(null); } function select(item: Expert) { setEditing(item); setForm({ name: item.name, prompt: item.prompt, skillIds: item.skillIds ?? [] }); }
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { if (editing) await api.patch(`/api/experts/${editing.id}`, form); else await api.post("/api/experts", form); await resource.reload(); notify(editing ? "专家已更新" : "专家已创建"); reset(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  async function remove() { if (!editing) return; setBusy(true); try { if (await removeResource(`/api/experts/${editing.id}`, editing.name, resource.reload, notify)) reset(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <div className="settings-panel"><SettingsHeader eyebrow="SPECIALIST PROFILES" title="专家" detail="把系统提示与一组技能组合成可重复选择的工作角色。" icon={<Bot size={20} />} /><div className="settings-editor-grid"><div><ResourceFeedback loading={resource.loading} error={resource.error} empty={!resource.data.length} emptyText="还没有专家" /><EntityList items={resource.data} selectedId={editing?.id} title={(i) => i.name} subtitle={(i) => `${i.skillIds?.length ?? 0} 个技能`} onSelect={select} /></div><form className="resource-form" onSubmit={submit}><h4>{editing ? "编辑专家" : "创建专家"}</h4><Field label="名称"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="系统提示"><textarea required rows={8} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="定义专业边界、工作方式和输出标准…" /></Field><Field label="绑定技能"><IdChoices items={skills.filter((s) => s.enabled)} value={form.skillIds} onChange={(skillIds) => setForm({ ...form, skillIds })} /></Field>{error ? <p className="form-error">{error}</p> : null}<FormActions editing={Boolean(editing)} busy={busy} onReset={reset} onDelete={() => void remove()} /></form></div></div>;
}

function WorkspaceSettings({ resource, notify }: { resource: ResourceState<Workspace[]>; notify: (message: string) => void }) {
  const initial = { name: "", description: "" }; const [form, setForm] = useState(initial); const [editing, setEditing] = useState<Workspace | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  function reset() { setEditing(null); setForm(initial); setError(null); } function select(item: Workspace) { setEditing(item); setForm({ name: item.name, description: item.description ?? "" }); }
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { if (editing) await api.patch(`/api/workspaces/${editing.id}`, form); else await api.post("/api/workspaces", form); await resource.reload(); notify(editing ? "空间已更新" : "空间已创建"); reset(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  async function remove() { if (!editing) return; setBusy(true); try { if (await removeResource(`/api/workspaces/${editing.id}`, editing.name, resource.reload, notify)) reset(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <div className="settings-panel"><SettingsHeader eyebrow="PROJECT CONTEXT" title="空间" detail="用空间归拢会话与记忆，为长期工作建立稳定上下文。" icon={<FolderKanban size={20} />} /><div className="settings-editor-grid"><div><ResourceFeedback loading={resource.loading} error={resource.error} empty={!resource.data.length} emptyText="还没有空间" /><EntityList items={resource.data} selectedId={editing?.id} title={(i) => i.name} subtitle={(i) => i.description || "暂无描述"} onSelect={select} /></div><form className="resource-form" onSubmit={submit}><h4>{editing ? "编辑空间" : "创建空间"}</h4><Field label="名称"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="描述"><textarea rows={7} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>{error ? <p className="form-error">{error}</p> : null}<FormActions editing={Boolean(editing)} busy={busy} onReset={reset} onDelete={() => void remove()} /></form></div></div>;
}

function MemorySettings({ resource, workspaces, notify }: { resource: ResourceState<Memory[]>; workspaces: Workspace[]; notify: (message: string) => void }) {
  const initial = { title: "", content: "", workspaceId: "" }; const [form, setForm] = useState(initial); const [editing, setEditing] = useState<Memory | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  function reset() { setEditing(null); setForm(initial); setError(null); } function select(item: Memory) { setEditing(item); setForm({ title: item.title, content: item.content, workspaceId: item.workspaceId ?? "" }); }
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { const payload = { title: form.title, content: form.content, workspaceId: form.workspaceId || null }; if (editing) await api.patch(`/api/memories/${editing.id}`, payload); else await api.post("/api/memories", payload); await resource.reload(); notify(editing ? "记忆已更新" : "记忆已创建"); reset(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  async function remove() { if (!editing) return; setBusy(true); try { if (await removeResource(`/api/memories/${editing.id}`, editing.title, resource.reload, notify)) reset(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <div className="settings-panel"><SettingsHeader eyebrow="DURABLE MEMORY" title="记忆" detail="保存可复用的业务事实与偏好，可选绑定到一个空间。" icon={<Brain size={20} />} /><div className="settings-editor-grid"><div><ResourceFeedback loading={resource.loading} error={resource.error} empty={!resource.data.length} emptyText="还没有记忆" /><EntityList items={resource.data} selectedId={editing?.id} title={(i) => i.title} subtitle={(i) => i.content.slice(0, 56)} onSelect={select} /></div><form className="resource-form" onSubmit={submit}><h4>{editing ? "编辑记忆" : "添加记忆"}</h4><Field label="标题"><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field><Field label="所属空间"><select value={form.workspaceId} onChange={(e) => setForm({ ...form, workspaceId: e.target.value })}><option value="">通用记忆</option>{workspaces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="内容"><textarea required rows={10} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field>{error ? <p className="form-error">{error}</p> : null}<FormActions editing={Boolean(editing)} busy={busy} onReset={reset} onDelete={() => void remove()} /></form></div></div>;
}

function AutomationSettings({ resource, skills, connectors, models, notify }: { resource: ResourceState<Automation[]>; skills: Skill[]; connectors: Connector[]; models: Model[]; notify: (message: string) => void }) {
  const initial = { name: "", prompt: "", cron: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai", skillIds: [] as string[], connectorIds: [] as string[], modelId: "", enabled: true }; const [form, setForm] = useState(initial); const [editing, setEditing] = useState<Automation | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); }, [editing]);
  function reset() { setEditing(null); setForm(initial); } function select(item: Automation) { setEditing(item); setForm({ name: item.name, prompt: item.prompt, cron: item.cron, timezone: item.timezone, skillIds: item.skillIds ?? [], connectorIds: item.connectorIds ?? [], modelId: item.modelId ?? "", enabled: item.enabled }); }
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { const payload = { ...form, modelId: form.modelId || null }; if (editing) await api.patch(`/api/automations/${editing.id}`, payload); else await api.post("/api/automations", payload); await resource.reload(); notify(editing ? "自动化已更新" : "自动化已创建"); reset(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  async function remove() { if (!editing) return; setBusy(true); try { if (await removeResource(`/api/automations/${editing.id}`, editing.name, resource.reload, notify)) reset(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  return <div className="settings-panel"><SettingsHeader eyebrow="SCHEDULED RUNS" title="自动化" detail="使用 cron 与时区创建持久调度，到点生成独立运行。" icon={<Clock3 size={20} />} /><div className="settings-editor-grid"><div><ResourceFeedback loading={resource.loading} error={resource.error} empty={!resource.data.length} emptyText="还没有自动化" /><EntityList items={resource.data} selectedId={editing?.id} title={(i) => i.name} subtitle={(i) => `${i.enabled ? "启用" : "停用"} · ${i.cron} · ${i.timezone}`} onSelect={select} /></div><form className="resource-form resource-form--dense" onSubmit={submit}><h4>{editing ? "编辑自动化" : "创建自动化"}</h4><Field label="名称"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="任务提示"><textarea required rows={5} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} /></Field><div className="field-row"><Field label="Cron"><input required value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} placeholder="0 9 * * 1-5" /></Field><Field label="时区"><input required value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></Field></div><Field label="模型"><select value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })}><option value="">默认模型</option>{models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field><Field label="技能"><IdChoices items={skills.filter((s) => s.enabled)} value={form.skillIds} onChange={(skillIds) => setForm({ ...form, skillIds })} /></Field><Field label="MCP"><IdChoices items={connectors} value={form.connectorIds} onChange={(connectorIds) => setForm({ ...form, connectorIds })} /></Field><label className="switch-row"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /><span><strong>启用调度</strong><small>停用后保留配置，但不再创建新运行</small></span></label>{error ? <p className="form-error">{error}</p> : null}<FormActions editing={Boolean(editing)} busy={busy} onReset={reset} onDelete={() => void remove()} /></form></div></div>;
}

function UsageSettings({ resource }: { resource: ResourceState<Usage> }) {
  const usage = resource.data;
  const number = new Intl.NumberFormat("zh-CN");
  return <div className="settings-panel usage-panel"><SettingsHeader eyebrow="ACCOUNT METER" title="用量" detail="当前账号累计运行与模型消耗，以服务端计量为准。" icon={<ChartNoAxesColumn size={20} />} />{resource.loading ? <Spinner label="读取用量" /> : null}{resource.error ? <StateBlock kind="error" title="用量读取失败" detail={resource.error} /> : null}{!resource.loading && !resource.error ? <div className="metric-grid"><article><span>RUNS</span><strong>{number.format(usage.runs)}</strong><small>累计运行</small></article><article><span>INPUT</span><strong>{number.format(usage.inputTokens)}</strong><small>输入 Tokens</small></article><article><span>OUTPUT</span><strong>{number.format(usage.outputTokens)}</strong><small>输出 Tokens</small></article><article className="metric-card--accent"><span>COST</span><strong className={usage.cost === null ? "metric-unpriced" : ""}>{usage.cost === null ? "未配置计价" : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD" }).format(usage.cost)}</strong><small>{usage.cost === null ? "模型价格表未配置" : "累计模型费用"}</small></article></div> : null}</div>;
}
