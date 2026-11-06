import { updateApi, useUpdateStore } from "../store/updateStore";
import "./UpdatePanel.css";

const labels: Record<string, string> = { idle: "当前版本", checking: "正在检查更新…", available: "发现新版本",
  downloading: "正在下载更新…", ready: "更新已下载", waitingForIdle: "等待任务安全结束…", preparing: "正在备份并准备安装…",
  installing: "正在启动安装…", verifying: "正在检查新版本…", recoveryRequired: "需要修复安装" };
export function AppVersion() {
  const version = useUpdateStore((s) => s.snapshot?.currentVersion);
  return <>{version ? `v${version}` : ""}</>;
}
export default function UpdatePanel() {
  const { snapshot: s, commandError, run } = useUpdateStore();
  const api = updateApi();
  if (!api || !s) return null;
  const download = () => api.download(s.releaseId!);
  return <section className="update-panel" aria-label="应用更新" aria-busy={["checking", "preparing", "installing"].includes(s.state)}>
    <div className="update-heading"><strong>{labels[s.state]}</strong><span>{s.targetVersion ? `v${s.targetVersion}` : `v${s.currentVersion}`}</span></div>
    {!s.configured && <p>更新服务尚未配置，请联系管理员获取安装包。</p>}
    {s.channel === "manual-managed" && <p>此设备由企业管理员管理，请通过公司软件分发升级。</p>}
    {s.installMode === "manual" && s.configured && <p>下载完成后打开 DMG，退出应用，再将新版本拖入“应用程序”完成覆盖安装。</p>}
    {s.progress && s.state === "downloading" && <div aria-live="polite"><progress value={s.progress.percent} max={100} /><span>{s.progress.percent.toFixed(0)}% · {(s.progress.transferred / 1048576).toFixed(1)} / {(s.progress.total / 1048576).toFixed(1)} MB</span></div>}
    {s.blockedBy?.length ? <p>正在等待 {s.blockedBy.length} 类后台工作完成；取消等待可继续使用。</p> : null}
    {s.releaseNotes && <details><summary>版本说明</summary><p className="update-notes">{s.releaseNotes}</p></details>}
    {(s.error || commandError) && <p className="update-error" role="alert">{s.error?.message || commandError}</p>}
    <div className="update-actions">
      {s.configured && s.channel !== "manual-managed" && ["idle", "available", "ready"].includes(s.state) && <button onClick={() => void run(() => api.check())}>检查更新</button>}
      {s.state === "available" && <button onClick={() => void run(download)}>下载更新</button>}
      {s.state === "downloading" && <button onClick={() => void run(() => api.cancelDownload(s.operationId!))}>取消下载</button>}
      {s.state === "ready" && <>
        <button onClick={() => void run(() => api.install(s.releaseId!, "now"))}>{s.installMode === "manual" ? "停止任务并打开安装包" : "停止任务并重启更新"}</button>
        <button onClick={() => void run(() => api.install(s.releaseId!, "when-idle"))}>任务完成后更新</button>
      </>}
      {s.state === "waitingForIdle" && <button onClick={() => void run(() => api.defer(s.releaseId!))}>取消等待</button>}
      <button onClick={() => void run(() => api.openLogs())}>查看更新记录与备份</button>
    </div>
  </section>;
}
