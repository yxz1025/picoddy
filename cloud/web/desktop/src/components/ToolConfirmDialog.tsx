import { useStore } from "../store/useStore";
import { ShieldAlert, Play, X } from "lucide-react";
import "./ToolConfirmDialog.css";

/**
 * 工具确认卡片（对标 参考设计 / CodeX：直接内联在 Chat 消息流内部，不使用悬浮弹窗）。
 */
export default function ToolConfirmDialog() {
  const { pendingConfirm, respondConfirm } = useStore();

  if (!pendingConfirm) return null;

  const { toolName, args } = pendingConfirm;

  const commandText = toolName === "bash"
    ? (args?.command || "")
    : toolName === "write" || toolName === "edit"
      ? `${toolName} → ${args?.path || args?.filePath || "unknown"}`
      : `${toolName}\n${JSON.stringify(args ?? {}, null, 2)}`;

  const labelMap: Record<string, string> = {
    bash: "终端命令",
    write: "写入文件",
    edit: "编辑文件",
    mouse_click: "鼠标点击",
    key_type: "键盘输入",
    memory_write: "写入记忆",
    write_docx: "生成文档",
    write_xlsx: "生成表格",
    write_pptx: "生成演示",
  };
  const label = labelMap[toolName] || toolName;

  return (
    <div className="inline-tool-confirm-card" style={{
      margin: "12px 0",
      padding: "12px 14px",
      borderRadius: 12,
      background: "var(--bg-sidebar)",
      border: "1px solid var(--accent-border)",
      boxShadow: "var(--shadow-sm)",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      maxWidth: 720,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ShieldAlert size={16} style={{ color: "var(--amber)" }} />
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
          申请运行指令：{label}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "var(--amber-soft)", color: "var(--amber)", fontWeight: 500 }}>
          需要授权
        </span>
      </div>

      <pre style={{
        fontFamily: "var(--mono)",
        fontSize: 12,
        padding: "8px 10px",
        background: "var(--code-bg)",
        color: "var(--code-text)",
        borderRadius: 8,
        overflowX: "auto",
        margin: 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}>
        {commandText}
      </pre>

      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
        <button
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "5px 12px", borderRadius: 6, border: "none",
            background: "var(--accent)", color: "#fff",
            fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}
          onClick={() => respondConfirm(true)}
        >
          <Play size={13} /> 授权运行
        </button>
        <button
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "5px 12px", borderRadius: 6,
            border: "1px solid var(--border-strong)",
            background: "var(--bg)", color: "var(--text)",
            fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}
          onClick={() => respondConfirm(false)}
        >
          <X size={13} /> 拒绝执行
        </button>
      </div>
    </div>
  );
}
