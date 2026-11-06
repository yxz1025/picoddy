import { useState } from "react";
import { ArrowUpToLine, X } from "lucide-react";
import { updateApi, useUpdateStore } from "../store/updateStore";
import "./UpdateToast.css";

export default function UpdateToast() {
  const { snapshot: s, commandError, run } = useUpdateStore();
  const [dismissed, setDismissed] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const api = updateApi();
  const key = `${s?.releaseId}:${s?.state}:${s?.error?.code ?? ""}:${commandError ?? ""}`;
  if (!api || !s?.releaseId || !s.configured || s.channel === "manual-managed" ||
      !["available", "downloading", "ready", "waitingForIdle", "preparing", "installing"].includes(s.state) || dismissed === key) return null;
  const titles: Record<string, string> = {
    available: "发现新版本", downloading: `正在下载 ${s.progress?.percent.toFixed(0) ?? 0}%`,
    ready: "新版本就绪", waitingForIdle: "等待任务结束", preparing: "正在备份数据", installing: "正在打开安装程序",
  };
  return <aside className="update-toast" aria-label="应用更新提示">
    <button className="update-toast-close" aria-label="暂时关闭更新提示" onClick={() => setDismissed(key)}><X size={14} /></button>
    <div className="update-toast-row">
      <ArrowUpToLine size={19} className="update-toast-icon" />
      <div className="update-toast-title" role="status"><strong>{titles[s.state]}</strong><span>v{s.targetVersion}</span></div>
      <button onClick={() => setNotesOpen(!notesOpen)} aria-expanded={notesOpen}>更新日志</button>
      {s.state === "available" && <button className="update-toast-primary" onClick={() => void run(() => api.download(s.releaseId!))}>下载更新</button>}
      {s.state === "downloading" && <button onClick={() => void run(() => api.cancelDownload(s.operationId!))}>取消下载</button>}
      {s.state === "ready" && <button className="update-toast-primary" onClick={() => void run(() => api.install(s.releaseId!, "when-idle"))}>立即安装</button>}
      {s.state === "waitingForIdle" && <button onClick={() => void run(() => api.defer(s.releaseId!))}>取消等待</button>}
    </div>
    {s.state === "downloading" && <progress aria-label="更新下载进度" value={s.progress?.percent ?? 0} max={100} />}
    {s.state === "ready" && s.installMode === "manual" && <p>安装将退出应用并打开 DMG，请拖入“应用程序”覆盖安装。</p>}
    {s.state === "waitingForIdle" && <p>后台任务完成后继续安装。</p>}
    {notesOpen && <p className="update-toast-notes">{s.releaseNotes || "此版本暂无更新日志。"}</p>}
    {(s.error || commandError) && <p role="alert">{s.error?.message || commandError}</p>}
  </aside>;
}
