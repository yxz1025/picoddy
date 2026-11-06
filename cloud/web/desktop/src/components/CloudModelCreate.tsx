import { useState } from "react";
import { requestCloudJson } from "../api/cloudHttp";
import { useStore } from "../store/useStore";

export default function CloudModelCreate() {
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState({ name: "", provider: "openai", model: "", baseUrl: "", apiKey: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const providers = useStore((state) => state.settings.providers ?? []);
  const models = providers.flatMap((provider: any) => (provider.models ?? []).filter((model: any) => model.resourceId).map((model: any) => ({ ...model, providerName: provider.name })));
  async function remove(id: string, name: string) {
    if (!await useStore.getState().requestUiConfirm(`删除云端模型“${name}”？正在运行的任务保留原有配置快照。`)) return;
    setBusy(true); setError("");
    try {
      await requestCloudJson("DELETE", `/api/models/${encodeURIComponent(id)}`);
      await useStore.getState().loadSettings();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError("");
    try {
      await requestCloudJson("POST", "/api/models", {
        ...form, name: form.name.trim() || form.model.trim(), model: form.model.trim(),
        baseUrl: form.baseUrl.trim() || undefined,
      });
      setForm({ name: "", provider: "openai", model: "", baseUrl: "", apiKey: "" });
      await useStore.getState().loadSettings();
      setExpanded(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <div className="security-card-box full-width" style={{ marginBottom: 16 }}>
    <div className="security-card-header"><h3 className="security-card-title">云端模型</h3>
      <button className="settings-btn" onClick={() => setExpanded(!expanded)} disabled={busy}>{expanded ? "收起" : "添加模型"}</button>
    </div>
    <p className="settings-section-desc">创建时同时保存模型 ID 与密钥。密钥仅通过本站接口发送并在服务端加密。</p>
    {models.map((model: any) => <div className="settings-item-card" key={model.resourceId}>
      <span>{model.providerName} · {model.name || model.id}</span>
      <button className="settings-btn" disabled={busy} onClick={() => void remove(model.resourceId, model.name || model.id)}>删除</button>
    </div>)}
    {expanded && <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="auth-field">渠道<select className="settings-select" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })}>
        {[["openai", "OpenAI / 兼容 API"], ["anthropic", "Anthropic"], ["google", "Google"], ["deepseek", "DeepSeek"], ["moonshot", "Moonshot"], ["qwen", "通义千问"]].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      {([["name", "显示名称（可选）"], ["model", "模型 ID"], ["baseUrl", "自定义 HTTPS 端点（可选，需管理员允许）"], ["apiKey", "API Key"]] as const).map(([key, label]) =>
        <label className="auth-field" key={key}>{label}<input className="settings-input" type={key === "apiKey" ? "password" : "text"} autoComplete="off" required={key === "model" || key === "apiKey"} disabled={busy} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}
      <button className="settings-btn" type="submit" disabled={busy}>{busy ? "保存中…" : "保存模型"}</button>
    </form>}
    {error && <p role="alert" style={{ color: "var(--red-text)" }}>{error}</p>}
  </div>;
}
