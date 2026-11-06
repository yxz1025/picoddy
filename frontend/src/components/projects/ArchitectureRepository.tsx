import { useEffect, useState } from "react";
import { GitBranch, FolderClosed, RotateCcw, Check } from "lucide-react";
import type { RepositoryContext } from "./projectDemo";

export default function ArchitectureRepository({ value, defaultRepository, locked, paused, onSave, onReopen, onDirtyChange }: {
  value?: RepositoryContext;
  defaultRepository: string;
  locked: boolean;
  paused: boolean;
  onSave: (value: RepositoryContext) => void;
  onReopen: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<RepositoryContext>(() => value ?? { repository: defaultRepository === "未配置" ? "" : defaultRepository, localPath: "", ref: "", scope: "", notes: "" });
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const disabled = locked || paused;
  function field(key: keyof RepositoryContext, label: string, placeholder: string, multiline = false) {
    return <label className="pw-field" key={key}>{label}{multiline
      ? <textarea rows={3} disabled={disabled} value={draft[key]} placeholder={placeholder} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
      : <input disabled={disabled} value={draft[key]} placeholder={placeholder} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />}</label>;
  }
  return <section className="pw-repository-panel" aria-label="研发设计关联仓库">
    <header><div><GitBranch size={18} /><h3>关联仓库代码</h3></div><span>{value ? "已配置 · 未读取源码" : "待关联"}</span></header>
    <p>让架构师同时参考需求与现有代码，设计具体到模块、接口和文件。仓库地址或本地目录至少填写一项。</p>
    <form onSubmit={(e) => {
      e.preventDefault();
      const cleaned = Object.fromEntries(Object.entries(draft).map(([key, text]) => [key, text.trim()])) as unknown as RepositoryContext;
      if ((!cleaned.repository && !cleaned.localPath) || !cleaned.ref || !cleaned.scope) { setError("请填写仓库或本地目录、分支 / Tag / Commit，以及重点分析范围。"); return; }
      setError(""); setDraft(cleaned); onSave(cleaned);
    }}>
      {field("repository", "仓库地址 / 标识", "https://git.example.com/team/repo.git")}
      {field("localPath", "本地代码目录", "/Users/yourname/projects/repository")}
      {field("ref", "分支 / Tag / Commit（必填）", "例如 main、release/v1.2 或完整 commit SHA")}
      {field("scope", "重点分析范围（必填）", "例如 src/domains/inventory、库存查询接口、现有补货流程；或填写“整个仓库”。", true)}
      {field("notes", "架构约束与参考（可选）", "例如沿用现有权限体系、不修改订单接口；参考 docs/architecture.md。", true)}
      <div className="pw-repository-next"><FolderClosed size={16} /><div><strong>关联后的设计输入</strong><p>目录结构、技术栈、现有接口与数据模型、受影响文件、测试与复用点。</p><small>当前仅保存关联信息；真实源码读取与版本校验待后端接入。</small></div></div>
      {error && <p role="alert">{error}</p>}
      <footer>{locked ? <><span>设计已完成，修改关联需要重新设计并审核下游产物。</span><button type="button" className="pw-secondary" disabled={paused} onClick={onReopen}><RotateCcw size={14} />重新设计</button></> : <><span>{value && !dirty ? "关联信息已保存" : "保存后可继续研发设计"}</span><button className="pw-secondary" type="submit" disabled={paused || !dirty}><Check size={14} />保存仓库关联</button></>}</footer>
    </form>
  </section>;
}
