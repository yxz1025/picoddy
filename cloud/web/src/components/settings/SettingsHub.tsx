import { useState } from "react";
import { Bot, Boxes, Brain, ChartNoAxesColumn, Clock3, Cpu, FolderKanban, PlugZap, Puzzle, X } from "lucide-react";

import { useApiResource } from "../../hooks/use-api-resource";
import type { Automation, Connector, Expert, Memory, Model, Workspace, SettingsSection, Skill, Usage } from "../../types";
import { Toast } from "../ui";
import { ResourceSettings } from "./ResourceSettings";
import { SkillSettings } from "./SkillSettings";

const sections: Array<{ id: SettingsSection; label: string; icon: typeof Puzzle }> = [
  { id: "skills", label: "个人技能", icon: Puzzle },
  { id: "models", label: "模型", icon: Cpu },
  { id: "connectors", label: "MCP 连接", icon: PlugZap },
  { id: "experts", label: "专家", icon: Bot },
  { id: "workspaces", label: "空间", icon: FolderKanban },
  { id: "memories", label: "记忆", icon: Brain },
  { id: "automations", label: "自动化", icon: Clock3 },
  { id: "usage", label: "用量", icon: ChartNoAxesColumn },
];

interface Props {
  open: boolean;
  onClose: () => void;
  skills: { data: Skill[]; loading: boolean; error: string | null; reload: () => Promise<unknown> };
  models: { data: Model[]; loading: boolean; error: string | null; reload: () => Promise<unknown> };
  connectors: { data: Connector[]; loading: boolean; error: string | null; reload: () => Promise<unknown> };
  experts: { data: Expert[]; loading: boolean; error: string | null; reload: () => Promise<unknown> };
  workspaces: { data: Workspace[]; loading: boolean; error: string | null; reload: () => Promise<unknown> };
}

export function SettingsHub(props: Props) {
  const [section, setSection] = useState<SettingsSection>("skills");
  const [toast, setToast] = useState<string | null>(null);
  const memories = useApiResource<Memory[]>("/api/memories", [], props.open);
  const automations = useApiResource<Automation[]>("/api/automations", [], props.open);
  const usage = useApiResource<Usage>("/api/usage", { runs: 0, inputTokens: 0, outputTokens: 0, cost: null }, props.open);

  if (!props.open) return null;
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  };

  return (
    <div className="settings-overlay">
      <section className="settings-hub" role="dialog" aria-modal="true" aria-label="工作台设置">
        <aside className="settings-nav">
          <div className="settings-nav__brand"><img className="brand-seal" src="/icon-128.png" alt="PiCoddy" /><div><strong>工作台设置</strong><small>CONTROL ROOM</small></div></div>
          <nav>{sections.map((item) => { const Icon = item.icon; return <button key={item.id} className={section === item.id ? "is-active" : ""} onClick={() => setSection(item.id)}><Icon size={17} /><span>{item.label}</span></button>; })}</nav>
          <div className="settings-nav__note"><Boxes size={16} /><span>所有配置仅属于当前账号，密钥读取时不会返回。</span></div>
        </aside>
        <div className="settings-content">
          <button className="icon-button settings-close" onClick={props.onClose} aria-label="关闭设置"><X size={20} /></button>
          {section === "skills" ? <SkillSettings skills={props.skills.data} loading={props.skills.loading} error={props.skills.error} reload={props.skills.reload} notify={notify} /> : null}
          {section !== "skills" ? (
            <ResourceSettings
              section={section}
              models={props.models}
              connectors={props.connectors}
              experts={props.experts}
              workspaces={props.workspaces}
              skills={props.skills.data}
              memories={memories}
              automations={automations}
              usage={usage}
              notify={notify}
            />
          ) : null}
        </div>
      </section>
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
