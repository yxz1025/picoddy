import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Archive, FileCode2, History, Power, Trash2, Upload } from "lucide-react";

import { api, errorMessage } from "../../api/client";
import { fileToBase64 } from "../../lib/file";
import type { Skill, SkillVersion } from "../../types";
import { Button, Spinner, StateBlock } from "../ui";

interface Props {
  skills: Skill[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<unknown>;
  notify: (message: string) => void;
}

export function SkillSettings({ skills, loading, error, reload, notify }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const installInput = useRef<HTMLInputElement>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const selected = skills.find((skill) => skill.id === selectedId) ?? skills[0] ?? null;

  useEffect(() => {
    if (!selected) {
      setVersions([]);
      return;
    }
    let active = true;
    api.get<SkillVersion[]>(`/api/skills/${selected.id}/versions`)
      .then((data) => { if (active) setVersions(data); })
      .catch((cause) => { if (active) setLocalError(errorMessage(cause)); });
    return () => { active = false; };
  }, [selected?.id]);

  async function upload(event: ChangeEvent<HTMLInputElement>, asVersion: boolean) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || (asVersion && !selected)) return;
    if (file.name !== "SKILL.md" && !file.name.toLowerCase().endsWith(".zip")) {
      setLocalError("请选择名为 SKILL.md 的文件或 .zip 技能包");
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      const payload = { filename: file.name, contentBase64: await fileToBase64(file) };
      if (asVersion && selected) {
        await api.post(`/api/skills/${selected.id}/versions`, { ...payload, expectedVersion: selected.version });
        notify("技能新版本已上传");
      } else {
        await api.post("/api/skills", payload);
        notify("技能已安装");
      }
      await reload();
    } catch (cause) {
      setLocalError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(skill: Skill) {
    setBusy(true);
    setLocalError(null);
    try {
      await api.patch(`/api/skills/${skill.id}`, { enabled: !skill.enabled, expectedVersion: skill.version });
      notify(skill.enabled ? "技能已停用" : "技能已启用");
      await reload();
    } catch (cause) {
      setLocalError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(skill: Skill) {
    if (!window.confirm(`卸载技能“${skill.name}”？历史运行引用的版本仍会保留。`)) return;
    setBusy(true);
    try {
      await api.delete(`/api/skills/${skill.id}`);
      setSelectedId(null);
      notify("技能已卸载");
      await reload();
    } catch (cause) {
      setLocalError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-panel">
      <div className="settings-panel__heading">
        <div><span className="eyebrow">PERSONAL CAPABILITIES</span><h3>个人技能</h3><p>安装 SKILL.md 或 zip 文件集；每次更新保留不可变版本。</p></div>
        <Button variant="primary" onClick={() => installInput.current?.click()} disabled={busy}><Upload size={16} /> 安装技能</Button>
        <input ref={installInput} hidden type="file" accept=".md,.zip,text/markdown,application/zip" onChange={(event) => void upload(event, false)} />
      </div>
      {localError ? <p className="form-error">{localError}</p> : null}
      {loading ? <Spinner label="读取技能" /> : null}
      {error ? <StateBlock kind="error" title="技能读取失败" detail={error} /> : null}
      {!loading && !error && skills.length === 0 ? <StateBlock kind="empty" title="还没有个人技能" detail="上传 SKILL.md 或包含脚本、引用与资源的 zip" /> : null}
      {skills.length ? (
        <div className="settings-split">
          <div className="settings-list">
            {skills.map((skill) => (
              <button key={skill.id} className={selected?.id === skill.id ? "is-active" : ""} onClick={() => setSelectedId(skill.id)}>
                <span className="settings-list__icon"><FileCode2 size={17} /></span>
                <span><strong>{skill.name}</strong><small>{skill.description || `版本 ${skill.version.slice(0, 10)}`}</small></span>
                <i className={skill.enabled ? "is-on" : ""} />
              </button>
            ))}
          </div>
          {selected ? (
            <section className="settings-detail">
              <header><div><span className="eyebrow">CURRENT SKILL</span><h4>{selected.name}</h4></div><span className={`tag ${selected.enabled ? "tag--success" : ""}`}>{selected.enabled ? "已启用" : "已停用"}</span></header>
              <p>{selected.description || "此技能没有提供描述。"}</p>
              <dl><div><dt>当前版本</dt><dd><code>{selected.version}</code></dd></div><div><dt>版本策略</dt><dd>历史任务冻结引用</dd></div></dl>
              <div className="detail-actions">
                <Button onClick={() => void toggle(selected)} disabled={busy}><Power size={15} /> {selected.enabled ? "停用" : "启用"}</Button>
                <Button onClick={() => versionInput.current?.click()} disabled={busy}><Archive size={15} /> 上传新版本</Button>
                <Button variant="danger" onClick={() => void remove(selected)} disabled={busy}><Trash2 size={15} /> 卸载</Button>
                <input ref={versionInput} hidden type="file" accept=".md,.zip,text/markdown,application/zip" onChange={(event) => void upload(event, true)} />
              </div>
              <div className="version-list"><h5><History size={15} /> 版本记录</h5>{versions.length === 0 ? <p className="empty-line">没有可显示的版本记录</p> : versions.map((version) => <div key={version.version}><code>{version.version.slice(0, 18)}</code><span>{version.createdAt ? new Intl.DateTimeFormat("zh-CN").format(new Date(version.createdAt)) : ""}</span></div>)}</div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
