import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useSkillStore } from "../store/useSkillStore";

export default function CloudSkillImport() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function install(file: File) {
    setBusy(true); setError("");
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error("技能包不能超过 25MB");
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("读取技能包失败"));
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.readAsDataURL(file);
      });
      const response = await fetch("/api/skills", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentBase64 }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error?.message || `安装失败（${response.status}），请检查文件大小或服务状态`);
      if (!result) throw new Error("服务返回了无效响应，请刷新技能列表确认安装结果");
      await useSkillStore.getState().loadSkills();
      useSkillStore.getState().setShowInstalledSkills(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  return <div>
    <input ref={input} type="file" accept=".md,.zip" hidden onChange={(event) => {
      const file = event.target.files?.[0]; if (file) void install(file);
    }} />
    <button className="ep-btn ep-btn-secondary" disabled={busy} onClick={() => input.current?.click()} title="上传 SKILL.md 或 ZIP，仅安装到当前账号">
      <Upload size={14} /><span className="ep-btn-label">{busy ? "安装中…" : "导入技能"}</span>
    </button>
    {error && <p role="alert" style={{ color: "var(--red-text)", maxWidth: 260 }}>{error}</p>}
  </div>;
}
