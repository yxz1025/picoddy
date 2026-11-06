import { useRef, useState, type ChangeEvent } from "react";
import { Activity, Download, File, FilePlus2, FolderOpen, PlugZap, RefreshCw, Trash2, Wrench, X } from "lucide-react";

import { api, errorMessage } from "../api/client";
import { fileToBase64, formatBytes } from "../lib/file";
import type { CloudFile, Connector, InspectorTab, Run, RunEvent, Skill } from "../types";
import type { ChatSelection } from "./ChatPanel";
import { Button, Spinner, StateBlock } from "./ui";

interface Props {
  open: boolean;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onClose: () => void;
  files: CloudFile[];
  skills: Skill[];
  connectors: Connector[];
  resourcesLoading: boolean;
  resourcesError: string | null;
  selection: ChatSelection;
  onSelectionChange: (selection: ChatSelection) => void;
  onReloadFiles: () => Promise<unknown>;
  run: Run | null;
  events: RunEvent[];
}

export function Inspector(props: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selected.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of selected) {
        await api.post<CloudFile>("/api/files", {
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          contentBase64: await fileToBase64(file),
        });
      }
      await props.onReloadFiles();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setUploading(false);
    }
  }

  async function remove(file: CloudFile) {
    if (!window.confirm(`删除文件“${file.name}”？此操作无法撤销。`)) return;
    setError(null);
    try {
      await api.delete(`/api/files/${file.id}`);
      props.onSelectionChange({ ...props.selection, fileIds: props.selection.fileIds.filter((id) => id !== file.id) });
      await props.onReloadFiles();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function toggle(kind: "skillIds" | "connectorIds" | "fileIds", id: string) {
    const current = props.selection[kind];
    props.onSelectionChange({
      ...props.selection,
      [kind]: current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    });
  }

  return (
    <aside className={`inspector ${props.open ? "inspector--open" : ""}`}>
      <header className="inspector__header">
        <div><span className="eyebrow">WORKBOX</span><h2>工作箱</h2></div>
        <button className="icon-button inspector__close" onClick={props.onClose} aria-label="关闭工作箱"><X size={18} /></button>
      </header>
      <div className="inspector-tabs" role="tablist">
        <button className={props.tab === "files" ? "is-active" : ""} onClick={() => props.onTabChange("files")}><FolderOpen size={16} /> 文件</button>
        <button className={props.tab === "tools" ? "is-active" : ""} onClick={() => props.onTabChange("tools")}><Wrench size={16} /> 工具</button>
        <button className={props.tab === "activity" ? "is-active" : ""} onClick={() => props.onTabChange("activity")}><Activity size={16} /> 动态</button>
      </div>

      <div className="inspector__body">
        {props.tab === "files" ? (
          <>
            <div className="panel-intro"><div><strong>输入与产物</strong><span>勾选后随下次任务发送</span></div><Button variant="quiet" onClick={() => fileInput.current?.click()} disabled={uploading}><FilePlus2 size={15} /> 上传</Button></div>
            <input ref={fileInput} type="file" multiple hidden onChange={(event) => void upload(event)} />
            {uploading ? <Spinner label="正在上传" /> : null}
            {error ? <p className="form-error">{error}</p> : null}
            {props.resourcesLoading ? <StateBlock kind="loading" title="读取文件" /> : null}
            {!props.resourcesLoading && props.files.length === 0 ? <StateBlock kind="empty" title="还没有文件" detail="上传本次任务需要的输入文件" /> : null}
            <div className="resource-check-list">
              {props.files.map((file) => (
                <div className="resource-check" key={file.id}>
                  <label>
                    <input type="checkbox" checked={props.selection.fileIds.includes(file.id)} onChange={() => toggle("fileIds", file.id)} />
                    <span className="file-icon"><File size={16} /></span>
                    <span><strong>{file.name}</strong><small>{formatBytes(file.size)} · {new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(file.createdAt))}</small></span>
                  </label>
                  <div className="row-actions">
                    <a className="icon-button" href={`/api/files/${file.id}/download`} download={file.name} aria-label={`下载 ${file.name}`}><Download size={15} /></a>
                    <button className="icon-button" onClick={() => void remove(file)} aria-label={`删除 ${file.name}`}><Trash2 size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {props.tab === "tools" ? (
          <>
            <div className="panel-intro"><div><strong>本次运行装配</strong><span>只加载明确勾选的能力</span></div></div>
            {props.resourcesError ? <StateBlock kind="error" title="工具读取失败" detail={props.resourcesError} /> : null}
            <section className="inspector-group">
              <h3><Wrench size={15} /> 个人技能 <span>{props.skills.filter((item) => item.enabled).length}</span></h3>
              {props.skills.filter((item) => item.enabled).length === 0 ? <p className="empty-line">没有已启用技能</p> : null}
              {props.skills.filter((item) => item.enabled).map((skill) => (
                <label className="tool-option" key={skill.id}>
                  <input type="checkbox" checked={props.selection.skillIds.includes(skill.id)} onChange={() => toggle("skillIds", skill.id)} />
                  <span><strong>{skill.name}</strong><small>{skill.description || `版本 ${skill.version}`}</small></span>
                </label>
              ))}
            </section>
            <section className="inspector-group">
              <h3><PlugZap size={15} /> MCP 连接 <span>{props.connectors.length}</span></h3>
              {props.connectors.length === 0 ? <p className="empty-line">还没有 MCP 连接</p> : null}
              {props.connectors.map((connector) => (
                <label className="tool-option" key={connector.id}>
                  <input type="checkbox" checked={props.selection.connectorIds.includes(connector.id)} onChange={() => toggle("connectorIds", connector.id)} />
                  <span><strong>{connector.name}</strong><small>{connector.transport === "stdio" ? "标准输入输出" : connector.url || "HTTP"}</small></span>
                </label>
              ))}
            </section>
          </>
        ) : null}

        {props.tab === "activity" ? (
          <>
            <div className="panel-intro"><div><strong>运行轨迹</strong><span>来自持久事件流</span></div>{props.run ? <button className="icon-button" onClick={() => props.onTabChange("activity")} aria-label="刷新视图"><RefreshCw size={15} /></button> : null}</div>
            {!props.run ? <StateBlock kind="empty" title="还没有运行" detail="发送任务后，这里会显示工具与状态事件" /> : null}
            {props.run ? (
              <div className="run-summary"><span>RUN</span><code>{props.run.id.slice(0, 8)}</code><strong>{props.run.status}</strong></div>
            ) : null}
            <ol className="event-timeline">
              {props.events.map((event) => (
                <li key={event.id} className={`event event--${event.type}`}>
                  <i />
                  <div><strong>{eventLabel(event)}</strong><small>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(event.createdAt))}</small>{eventDetail(event) ? <p>{eventDetail(event)}</p> : null}</div>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function eventLabel(event: RunEvent): string {
  if (event.type === "tool_start") return `开始工具 · ${String(event.payload.tool ?? event.payload.name ?? "未命名")}`;
  if (event.type === "tool_end") return `工具结束 · ${String(event.payload.tool ?? event.payload.name ?? "未命名")}`;
  if (event.type === "status") return `状态 · ${String(event.payload.status ?? "更新")}`;
  if (event.type === "approval") return "请求操作确认";
  if (event.type === "artifact") return `产物已发布 · ${String(event.payload.name ?? "文件")}`;
  if (event.type === "error") return "运行错误";
  if (event.type === "message") return "消息已保存";
  if (event.type === "text_delta") return "正在生成回复";
  return event.type;
}

function eventDetail(event: RunEvent): string {
  const value = event.payload.message ?? event.payload.error ?? event.payload.summary;
  return typeof value === "string" ? value : "";
}
