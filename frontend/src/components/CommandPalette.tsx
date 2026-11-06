import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";
import "./CommandPalette.css";

interface CommandItem {
  id: string;
  category: "model" | "mode" | "permission" | "skill";
  title: string;
  subtitle: string;
  icon: string;
  badge?: string;
  action: () => void;
}

export default function CommandPalette() {
  const {
    showCommandPalette,
    setShowCommandPalette,
    modelProvider,
    modelId,
    setModel,
    mode,
    setMode,
    permission,
    setPermission,
    sendMessage,
    settings,
    apiKeys,
  } = useStore();

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 全局 ⌘K / Ctrl+K 监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCommandPalette(!showCommandPalette);
      } else if (e.key === "Escape" && showCommandPalette) {
        setShowCommandPalette(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showCommandPalette, setShowCommandPalette]);

  if (!showCommandPalette) return null;

  // 动态构建模型 Command Items
  const dynamicModelItems: CommandItem[] = [];
  if (settings.providers && settings.providers.length > 0) {
    for (const p of settings.providers) {
      const isReady = p.id === "ollama" || p.isCustom === true || !!apiKeys[p.id] || (p.id === "openai" && settings.openaiSubscription === true);
      if (p.models && p.models.length > 0) {
        for (const m of p.models) {
          if (!isReady && !m.isVirtual) continue;
          const isCurrent = modelProvider === p.id && modelId === m.id;
          dynamicModelItems.push({
            id: `model-${p.id}-${m.id}`,
            category: "model",
            title: `${p.name || p.id}: ${m.name || m.id}`,
            subtitle: `切换大模型渠道为 ${p.name || p.id} (${m.id})`,
            icon: p.id === "ollama" ? "🦙" : p.id === "deepseek" ? "⚡" : p.id === "zhipu" ? "🧠" : "🤖",
            badge: isCurrent ? "当前模型" : undefined,
            action: () => {
              setModel(p.id, m.id);
              setShowCommandPalette(false);
            },
          });
        }
      }
    }
  }

  const modelItems = dynamicModelItems;

  const items: CommandItem[] = [
    // 1. 模型选择
    ...modelItems,
    // 2. 运行模式
    {
      id: "mode-craft",
      category: "mode",
      title: "Craft 模式 (直接执行)",
      subtitle: "允许 Agent 读取、写文件、执行 Shell 命令",
      icon: "🛠️",
      badge: mode === "craft" ? "当前模式" : undefined,
      action: () => {
        setMode("craft");
        setShowCommandPalette(false);
      },
    },
    {
      id: "mode-plan",
      category: "mode",
      title: "Plan 模式 (先分步方案)",
      subtitle: "Agent 只读分析并给出方案，用户确认后再写操作",
      icon: "📋",
      badge: mode === "plan" ? "当前模式" : undefined,
      action: () => {
        setMode("plan");
        setShowCommandPalette(false);
      },
    },
    {
      id: "mode-ask",
      category: "mode",
      title: "Ask 模式 (纯文本问答)",
      subtitle: "不调用任何本地工具，纯文字对话回答",
      icon: "💬",
      badge: mode === "ask" ? "当前模式" : undefined,
      action: () => {
        setMode("ask");
        setShowCommandPalette(false);
      },
    },
    // 3. 权限等级
    {
      id: "perm-default",
      category: "permission",
      title: "L2 权限 (写操作确认)",
      subtitle: "写文件或执行命令前先弹窗询问许可",
      icon: "🛡️",
      badge: permission === "default" || permission === "L2" ? "当前权限" : undefined,
      action: () => {
        setPermission("default");
        setShowCommandPalette(false);
      },
    },
    {
      id: "perm-full",
      category: "permission",
      title: "L3 权限 (全自动放行)",
      subtitle: "信任 Agent 自动完成所有读写与执行，无需确认",
      icon: "🚀",
      badge: permission === "full" || permission === "L3" ? "当前权限" : undefined,
      action: () => {
        setPermission("full");
        setShowCommandPalette(false);
      },
    },
    {
      id: "perm-readonly",
      category: "permission",
      title: "L1 权限 (严格只读)",
      subtitle: "拦截所有写入与修改操作",
      icon: "🔒",
      badge: permission === "readonly" || permission === "L1" ? "当前权限" : undefined,
      action: () => {
        setPermission("readonly");
        setShowCommandPalette(false);
      },
    },
    // 4. 快捷技能
    {
      id: "skill-weekly",
      category: "skill",
      title: "生成周报文档 (weekly-report)",
      subtitle: "一键调起周报生成技能，自动输出格式化 Word 报告",
      icon: "📝",
      action: () => {
        setShowCommandPalette(false);
        sendMessage("请帮我整理并生成一份本周工作周报 Word 文档");
      },
    },
    {
      id: "skill-analysis",
      category: "skill",
      title: "表格数据分析 (data-analysis)",
      subtitle: "分析指定的 Excel/CSV 表格并生成概况与图表摘要",
      icon: "📊",
      action: () => {
        setShowCommandPalette(false);
        sendMessage("请帮我读取并分析桌面上的数据表格文件");
      },
    },
    {
      id: "skill-ppt",
      category: "skill",
      title: "制作演示文稿 (presentation)",
      subtitle: "根据给定主题自动生成精美多页 PPT 文稿",
      icon: "🎨",
      action: () => {
        setShowCommandPalette(false);
        sendMessage("请帮我根据最近项目成果制作一份 PPT 演示文稿");
      },
    },
  ];

  const filteredItems = items.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      item.subtitle.toLowerCase().includes(query.toLowerCase())
  );

  const handleKeyDownInput = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === "Enter" && filteredItems[selectedIndex]) {
      e.preventDefault();
      filteredItems[selectedIndex].action();
    }
  };

  return (
    <div className="cmd-palette-backdrop" onClick={() => setShowCommandPalette(false)}>
      <div className="cmd-palette-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-palette-search">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="搜索指令、模型、模式或技能... (Esc 退出)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDownInput}
            autoFocus
          />
          <kbd className="cmd-kbd">⌘K</kbd>
        </div>

        <div className="cmd-palette-list">
          {filteredItems.length === 0 ? (
            <div className="cmd-empty">未匹配到相关指令</div>
          ) : (
            filteredItems.map((item, index) => (
              <div
                key={item.id}
                className={`cmd-item ${index === selectedIndex ? "selected" : ""}`}
                onClick={item.action}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="cmd-item-icon">{item.icon}</div>
                <div className="cmd-item-info">
                  <div className="cmd-item-title">
                    {item.title}
                    {item.badge && <span className="cmd-badge">{item.badge}</span>}
                  </div>
                  <div className="cmd-item-subtitle">{item.subtitle}</div>
                </div>
                <span className="cmd-enter-hint">↵ 执行</span>
              </div>
            ))
          )}
        </div>

        <div className="cmd-palette-footer">
          <span>↑↓ 导航</span>
          <span>↵ 选择</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
