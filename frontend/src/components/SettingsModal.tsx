import ChannelsSettings from "./channels/ChannelsSettings";
import OpenAISubscriptionControls from "./OpenAISubscriptionControls";
import BrowserAutomationSetting from "./BrowserAutomationSetting";
import UpdatePanel, { AppVersion } from "./UpdatePanel";
import { useEffect, useState } from "react";
import { type CustomModelLimits, useStore } from "../store/useStore";
import {
  Brain,
  Cpu,
  Eye,
  EyeOff,
  Laptop,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import "./SettingsModal.css";
import { PiLogo } from "./PiLogo";
import { pickDirectory } from "../api/client";

type TabId =
  | "channels"
  | "model"
  | "computer_use"
  | "memory"
  | "agent"
  | "system"
  | "help";

interface TabItem {
  id: TabId;
  label: string;
  icon: any;
}

const TABS: TabItem[] = [
  { id: "channels", label: "远程通道", icon: Laptop },
  { id: "model", label: "模型与 API 渠道", icon: Sparkles },
  { id: "computer_use", label: "电脑操控 (Computer Use)", icon: Laptop },
  { id: "memory", label: "长期记忆", icon: Brain },
  { id: "agent", label: "智能体设置", icon: Cpu },
  { id: "system", label: "常规与快捷键", icon: Settings },
  { id: "help", label: "帮助与更新", icon: Settings },
];

const OFFICIAL_CATALOG_PROVIDER_IDS = new Set([
  "deepseek",
  "moonshot",
  "minimax",
  "openai",
  "anthropic",
  "google",
  "zai",
  "qwen",
]);

/** 表单内的输入值以 K（1K = 1000 tokens）为单位、保留字符串，保存时再换算成 token 数。 */
interface CustomModelLimitsInput {
  contextWindow: string;
  maxOutputTokens: string;
}

/** token 数转成表单里的 K 值，最多保留 3 位小数。 */
function tokensToK(tokens: number | undefined): string {
  return tokens ? String(Number((tokens / 1000).toFixed(3))) : "";
}

function parseCustomModelIds(models: string): string[] {
  return [...new Set(models.split(",").map((s) => s.trim()).filter(Boolean))];
}

function customModelLimitsPayload(
  form: { models: string; modelLimits: Record<string, CustomModelLimitsInput> },
): Record<string, CustomModelLimits> {
  const kToTokens = (value: string | undefined) => {
    const n = Number(value?.trim());
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : undefined;
  };
  const result: Record<string, CustomModelLimits> = {};
  for (const modelId of parseCustomModelIds(form.models)) {
    const contextWindow = kToTokens(form.modelLimits[modelId]?.contextWindow);
    const maxOutputTokens = kToTokens(
      form.modelLimits[modelId]?.maxOutputTokens,
    );
    if (contextWindow || maxOutputTokens) {
      result[modelId] = { contextWindow, maxOutputTokens };
    }
  }
  return result;
}

export default function SettingsModal() {
  const {
    showSettings,
    setShowSettings,
    settings,
    updateSettings,
    apiKeys,
    saveApiKey,
    deleteApiKey,
    memories,
    loadMemories,
    deleteMemory,
    requestUiConfirm,
    testConnection,
    saveCustomProvider,
    deleteCustomProvider,
    fetchOllamaModels,
    fetchProviderModels,
    fetchCustomProviderModels,
  } = useStore();

  const [openAIAuthMode, setOpenAIAuthMode] = useState<"oauth" | "api_key" | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("model");

  // State for API keys form
  const [keysInput, setKeysInput] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  // State for Model tab testing & custom forms
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  // 自定义渠道弹窗中从 /models 拉取到的模型列表
  const [customCatalog, setCustomCatalog] = useState<
    Array<{ id: string; contextWindow?: number; maxOutputTokens?: number }>
  >([]);
  const [customCatalogLoading, setCustomCatalogLoading] = useState(false);
  const [customCatalogError, setCustomCatalogError] = useState("");
  const [customCatalogFilter, setCustomCatalogFilter] = useState("");
  const openCustomModal = () => {
    setCustomCatalog([]);
    setCustomCatalogError("");
    setCustomCatalogFilter("");
    setCustomModalOpen(true);
  };
  const [customForm, setCustomForm] = useState<
    {
      id?: string;
      name: string;
      baseUrl: string;
      apiKey: string;
      models: string;
      modelLimits: Record<string, CustomModelLimitsInput>;
    }
  >({
    name: "",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    models: "",
    modelLimits: {},
  });
  const [ollamaStatus, setOllamaStatus] = useState<any>(null);
  const [providerCatalogs, setProviderCatalogs] = useState<Record<string, any[]>>({});
  const [providerCatalogErrors, setProviderCatalogErrors] = useState<Record<string, string>>({});
  const [loadingCatalogProvider, setLoadingCatalogProvider] = useState<string | null>(null);

  // 自定义添加与删除 Provider 下的模型 ID
  const [newModelInputs, setNewModelInputs] = useState<Record<string, string>>(
    {},
  );
  const [selectedProviderModels, setSelectedProviderModels] = useState<
    Record<string, string>
  >({});

  const deleteModelFromProvider = (providerId: string, modelId: string) => {
    const newProviders = (settings.providers || []).map((p: any) => {
      if (p.id === providerId) {
        return {
          ...p,
          models: (p.models || []).filter((m: any) => m.id !== modelId),
        };
      }
      return p;
    });
    const removesDefault = settings.defaultProvider === providerId &&
      settings.defaultModelId === modelId;
    void updateSettings({
      providers: newProviders,
      ...(removesDefault
        ? { defaultProvider: "", defaultModelId: "" }
        : {}),
    });
  };

  const loadProviderCatalog = async (providerId: string, inputApiKey?: string) => {
    if (loadingCatalogProvider === providerId) return;
    if (!inputApiKey?.trim() && !apiKeys[providerId] && !(providerId === "openai" && settings.openaiSubscription)) {
      setProviderCatalogErrors((current) => ({
        ...current,
        [providerId]: "请先输入 API Key；无需保存即可加载模型",
      }));
      return;
    }

    setLoadingCatalogProvider(providerId);
    setProviderCatalogErrors((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
    const result = await fetchProviderModels(providerId, inputApiKey);
    if (result.ok && result.models) {
      setProviderCatalogs((current) => ({
        ...current,
        [providerId]: result.models || [],
      }));
    } else {
      setProviderCatalogs((current) => ({ ...current, [providerId]: [] }));
      setProviderCatalogErrors((current) => ({
        ...current,
        [providerId]: result.error || "获取模型失败",
      }));
    }
    setLoadingCatalogProvider(null);
  };

  // State for memory searching
  const [memorySearch, setMemorySearch] = useState("");

  // State for Computer Use system permissions
  const [systemPerms, setSystemPerms] = useState<any>(null);
  const [loadingPerms, setLoadingPerms] = useState(false);
  const isWindowsPermissions = systemPerms?.os === "windows";

  const fetchSystemPerms = async () => {
    setLoadingPerms(true);
    try {
      const res = await fetch("/api/system/permissions");
      const data = await res.json();
      setSystemPerms(data);
    } catch (e) {
      console.error("[SettingsModal] 获取权限状态失败:", e);
    } finally {
      setLoadingPerms(false);
    }
  };

  const openSystemSettings = async (target: "accessibility" | "screen") => {
    try {
      await fetch("/api/system/permissions/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
    } catch (e) {
      console.error("[SettingsModal] 打开系统偏好设置失败:", e);
    }
  };

  // Load memories and settings keys on mount
  useEffect(() => {
    if (showSettings) {
      useStore.getState().loadSettings();
      if (activeTab === "memory") {
        loadMemories();
      }
      if (activeTab === "computer_use") {
        fetchSystemPerms();
      }
      if (activeTab === "model") {
        fetchOllamaModels().then(setOllamaStatus);
      }
    }
  }, [showSettings, activeTab]);

  if (!showSettings) return null;

  // Handle Directory Browse for Default Workspace
  const handleBrowseWorkspaceDir = async () => {
    try {
      const data = await pickDirectory();
      if (data.cancelled || !data.path) return;
      updateSettings({ defaultWorkspaceDir: data.path });
    } catch (e) {
      console.error("[settings] pick-dir error:", e);
    }
  };

  // Convert fontSize string to slider index (values: 12, 14, 16, 18, 20, 22)
  const fontSizes = ["12", "14", "16", "18", "20", "22"];
  const getFontSliderValue = () => {
    const idx = fontSizes.indexOf(settings.fontSize || "14");
    return idx === -1 ? 1 : idx;
  };
  const configuredDefaultProviders = (settings.providers || []).filter(
    (provider: any) =>
      Array.isArray(provider.models) && provider.models.length > 0 &&
      (provider.id === "ollama" || provider.isCustom === true || provider.models.some((model: any) => model.isVirtual) || apiKeys[provider.id] || (provider.id === "openai" && settings.openaiSubscription)),
  );
  const selectedDefaultProvider = configuredDefaultProviders.find(
    (provider: any) => provider.id === settings.defaultProvider,
  );
  const selectedDefaultModels = selectedDefaultProvider?.models || [];
  const hasConfiguredDefaultProviders = configuredDefaultProviders.length > 0;
  const handleFontSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = parseInt(e.target.value, 10);
    updateSettings({ fontSize: fontSizes[idx] });
  };

  // Render Left Navigation Sidebar
  const renderSidebar = () => {
    return (
      <div className="settings-sidebar">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              className={`settings-tab-btn ${isActive ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="settings-tab-icon">
                <Icon size={16} />
              </span>
              <span className="settings-tab-label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  // Render Right Details Panel according to activeTab
  const renderContent = () => {
    switch (activeTab) {
      case "channels":
        return <ChannelsSettings />;
      case "computer_use":
        return (
          <div className="settings-tab-content">
            <h2 className="settings-content-title">电脑操控 (Computer Use)</h2>
            <BrowserAutomationSetting />
            <p
              className="settings-section-desc"
              style={{ color: "var(--text-2)", marginBottom: 16, fontSize: 13 }}
            >
              基于 CodeX / Anthropic 规范的屏幕识别与鼠标键盘掌控通道。支持
              Retina 高分屏坐标自动换算与 AppleScript 降级执行。
            </p>

            <div className="settings-section">
              {/* 依赖与权限检测卡片 */}
              <div className="security-card-box full-width">
                <div className="security-card-header">
                  <div className="security-card-title-group">
                    <Laptop size={18} className="icon-blue" />
                    <h3 className="security-card-title">系统依赖与权限诊断</h3>
                  </div>
                  <button
                    className="settings-btn"
                    onClick={fetchSystemPerms}
                    disabled={loadingPerms}
                  >
                    {loadingPerms ? "检测中..." : "重新检测"}
                  </button>
                </div>

                <div
                  className="perm-diag-list"
                  style={{
                    marginTop: 14,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {/* 屏幕录制 */}
                  <div
                    className="perm-diag-item"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 12px",
                      background: "var(--bg-subtle)",
                      borderRadius: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {isWindowsPermissions
                          ? "Windows 屏幕捕获"
                          : "屏幕录制权限 (Screen Recording)"}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                        {isWindowsPermissions
                          ? "通过 Windows Forms 与 GDI 捕获虚拟桌面，供视觉模型分析"
                          : "用于截取屏幕投递给视觉 LLM（请在系统设置「隐私与安全性 → 屏幕与系统音频录制」中勾选当前 App 或 Terminal）"}
                      </div>
                    </div>
                    <div
                      style={{
                        marginLeft: "auto",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        className={`log-status-badge ${
                          systemPerms?.screenRecordingGranted
                            ? "success"
                            : "error"
                        }`}
                      >
                        {systemPerms?.screenRecordingGranted
                          ? "已准备就绪"
                          : "待授权 (未勾选屏幕录制)"}
                      </span>
                      {!isWindowsPermissions && (
                        <button
                          className="settings-btn"
                          style={{ padding: "4px 8px", fontSize: 11 }}
                          onClick={() => openSystemSettings("screen")}
                        >
                          打开授权页面
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 辅助功能 */}
                  <div
                    className="perm-diag-item"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 12px",
                      background: "var(--bg-subtle)",
                      borderRadius: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {isWindowsPermissions
                          ? "Windows 桌面控制"
                          : "辅助功能权限 (Accessibility)"}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                        {isWindowsPermissions
                          ? "通过 Win32、UI Automation 和 SendKeys 控制窗口、鼠标与键盘"
                          : "用于模拟点击、键盘输入与滚动控制"}
                      </div>
                    </div>
                    <div
                      style={{
                        marginLeft: "auto",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        className={`log-status-badge ${
                          systemPerms?.accessibilityGranted
                            ? "success"
                            : "error"
                        }`}
                      >
                        {systemPerms?.accessibilityGranted
                          ? "已授权"
                          : "未授权 (将拦截点击)"}
                      </span>
                      {!isWindowsPermissions && (
                        <button
                          className="settings-btn"
                          style={{ padding: "4px 8px", fontSize: 11 }}
                          onClick={() => openSystemSettings("accessibility")}
                        >
                          打开授权设置
                        </button>
                      )}
                    </div>
                  </div>

                  {/* cliclick 依赖 */}
                  {!isWindowsPermissions && (
                    <div
                      className="perm-diag-item"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 12px",
                        background: "var(--bg-subtle)",
                        borderRadius: 8,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          cliclick 命令行工具 (快捷操作增强)
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                          未安装时系统将自动降级使用 macOS 原生 AppleScript
                        </div>
                      </div>
                      <div
                        style={{
                          marginLeft: "auto",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          className={`log-status-badge ${
                            systemPerms?.cliclickInstalled
                              ? "success"
                              : "warning"
                          }`}
                          style={!systemPerms?.cliclickInstalled
                            ? {
                              background: "var(--amber-soft)",
                              color: "var(--amber)",
                            }
                            : {}}
                        >
                          {systemPerms?.cliclickInstalled
                            ? "已安装"
                            : "未安装 (已降级原生)"}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* 显示器分辨率与 Retina 信息 */}
                  {systemPerms?.metrics && (
                    <div
                      className="perm-diag-item"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 12px",
                        background: "var(--bg-subtle)",
                        borderRadius: 8,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          显示屏分辨率与缩放比
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                          逻辑点阵: {systemPerms.metrics.width} x{" "}
                          {systemPerms.metrics.height} | 缩放比:{" "}
                          {systemPerms.metrics.scaleFactor}x
                        </div>
                      </div>
                      <div
                        style={{
                          marginLeft: "auto",
                          fontSize: 11.5,
                          color: "var(--text-2)",
                          fontWeight: 500,
                        }}
                      >
                        {isWindowsPermissions
                          ? "Windows 逻辑坐标就绪"
                          : "Retina 坐标自动换算就绪"}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );

      case "system":
        return (
          <div className="settings-tab-content">
            <h2 className="settings-content-title">系统设置</h2>
            <div className="settings-section">
              {/* 显示语言 */}
              <div className="settings-item-card">
                <div className="settings-item-meta">
                  <label className="settings-item-title">显示语言</label>
                  <p className="settings-item-desc">
                    设置应用程序界面的显示语言。
                  </p>
                </div>
                <div className="settings-item-control">
                  <select
                    className="settings-select"
                    value={settings.language || "zh-CN"}
                    onChange={(e) =>
                      updateSettings({ language: e.target.value })}
                  >
                    <option value="zh-CN">中文(简体)</option>
                    <option value="en-US">English</option>
                  </select>
                </div>
              </div>

              {/* 字体大小 */}
              <div className="settings-item-card col-layout">
                <div className="settings-item-meta">
                  <label className="settings-item-title">字体大小</label>
                </div>
                <div className="settings-item-control slider-wrapper">
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="1"
                    className="settings-slider"
                    value={getFontSliderValue()}
                    onChange={handleFontSliderChange}
                  />
                  <div className="slider-ticks">
                    <span>小</span>
                    <span>默认</span>
                    <span>稍大</span>
                    <span>大</span>
                    <span>特大</span>
                    <span>超大</span>
                  </div>
                </div>
              </div>

              {/* 非高风险技能自动安装 */}
              <div className="settings-item-card">
                <div className="settings-item-meta">
                  <label className="settings-item-title">
                    非高风险技能自动安装
                  </label>
                  <p className="settings-item-desc">
                    上传技能后仍会显示安全检测过程；检测结果为非高风险时自动继续安装，高风险始终需要手动确认。
                  </p>
                </div>
                <div className="settings-item-control">
                  <label className="switch-toggle">
                    <input
                      type="checkbox"
                      checked={!!settings.autoInstallSkills}
                      onChange={(e) =>
                        updateSettings({ autoInstallSkills: e.target.checked })}
                    />
                    <span className="slider-round"></span>
                  </label>
                </div>
              </div>

              {/* 锁屏远程 */}
              <div className="settings-item-card">
                <div className="settings-item-meta">
                  <label className="settings-item-title">锁屏远程</label>
                  <p className="settings-item-desc">
                    开启后即使在锁屏状态下，电脑也不会进入休眠、屏幕也不会自动关闭，方便通过手机远程操控和保持自动化任务持续进行。
                  </p>
                </div>
                <div className="settings-item-control">
                  <label className="switch-toggle">
                    <input
                      type="checkbox"
                      checked={!!settings.keepAwake}
                      onChange={(e) =>
                        updateSettings({ keepAwake: e.target.checked })}
                    />
                    <span className="slider-round"></span>
                  </label>
                </div>
              </div>

              {/* 默认工作空间存储路径 */}
              <div className="settings-item-card col-layout">
                <div className="settings-item-meta">
                  <label className="settings-item-title">
                    默认工作空间存储路径
                  </label>
                  <p className="settings-item-desc">
                    新建任务、工作空间时将自动存放在该路径下。修改后不影响已有数据。
                  </p>
                </div>
                <div className="settings-input-row" style={{ marginTop: 8 }}>
                  <input
                    type="text"
                    className="settings-input"
                    value={settings.defaultWorkspaceDir || "~/PiCoddy"}
                    onChange={(e) =>
                      updateSettings({ defaultWorkspaceDir: e.target.value })}
                  />
                  <button
                    className="settings-btn"
                    onClick={handleBrowseWorkspaceDir}
                  >
                    更改
                  </button>
                </div>
              </div>

              {/* 体验优化计划 */}
              <div className="settings-item-card">
                <div className="settings-item-meta">
                  <label className="settings-item-title">体验优化计划</label>
                  <p className="settings-item-desc">
                    允许我们使用您的数据进行模型优化，提升产品使用体验。我们将采取措施保护您的数据。
                    {" "}
                    <a href="#learn-more" className="settings-link">
                      了解更多
                    </a>
                  </p>
                </div>
                <div className="settings-item-control">
                  <label className="switch-toggle">
                    <input
                      type="checkbox"
                      checked={settings.experienceOpt !== false}
                      onChange={(e) =>
                        updateSettings({ experienceOpt: e.target.checked })}
                    />
                    <span className="slider-round"></span>
                  </label>
                </div>
              </div>
              {/* 默认搜索引擎 */}
              <div className="settings-item-card">
                <div className="settings-item-meta">
                  <label className="settings-item-title">默认搜索引擎</label>
                  <p className="settings-item-desc">
                    智能体在需要联网检索信息时默认选用的搜索引擎。
                  </p>
                </div>
                <div className="settings-item-control">
                  <select
                    className="settings-select"
                    value={settings.searchEngine || "google"}
                    onChange={(e) =>
                      updateSettings({ searchEngine: e.target.value })}
                  >
                    <option value="google">Google Search</option>
                    <option value="bing">Bing Search</option>
                    <option value="duckduckgo">DuckDuckGo</option>
                  </select>
                </div>
              </div>

              {/* 快捷键列表 */}
              <div
                className="security-card-box full-width"
                style={{ marginTop: 16 }}
              >
                <h3 className="security-card-title" style={{ marginBottom: 8 }}>
                  ⌨️ 快捷键说明列表
                </h3>
                <div className="shortcuts-list" style={{ marginTop: 8 }}>
                  {[
                    {
                      keys: ["Option", "Space"],
                      desc: "全局唤醒 / 隐藏 PiCoddy 桌面窗口",
                    },
                    { keys: ["Cmd", "Enter"], desc: "发送当前输入的指令" },
                    { keys: ["Shift", "Enter"], desc: "在输入框中插入新行" },
                    { keys: ["Cmd", "N"], desc: "快速创建一个新的对话任务" },
                    { keys: ["Cmd", "K"], desc: "呼出全局命令快捷面板" },
                    { keys: ["Esc"], desc: "关闭当前弹窗或中断会话生成" },
                  ].map((sh, idx) => (
                    <div
                      key={idx}
                      className="shortcut-row"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "6px 0",
                        borderBottom: "1px solid var(--border-color)",
                      }}
                    >
                      <span
                        className="shortcut-desc"
                        style={{ fontSize: 13, color: "var(--text)" }}
                      >
                        {sh.desc}
                      </span>
                      <div
                        className="shortcut-keys"
                        style={{ display: "flex", gap: 4 }}
                      >
                        {sh.keys.map((k, kIdx) => (
                          <kbd
                            key={kIdx}
                            className="kbd-key"
                            style={{
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: "var(--bg-3)",
                              fontSize: 11,
                              border: "1px solid var(--border-color)",
                            }}
                          >
                            {k}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );

      case "memory":
        const filteredMemories = memories.filter((m) =>
          (m.content || "").toLowerCase().includes(memorySearch.toLowerCase())
        );
        return (
          <div className="settings-tab-content">
            <h2 className="settings-content-title">长期记忆管理</h2>
            <div className="settings-section">
              <p className="settings-intro-text">
                智能体在对话中习得的知识和偏好会自动存入长期记忆，以便在后续对话中为您提供个性化服务。
              </p>
              <div style={{ marginBottom: 12 }}>
                <input
                  type="text"
                  className="settings-input w-full"
                  placeholder="搜索记忆项..."
                  value={memorySearch}
                  onChange={(e) => setMemorySearch(e.target.value)}
                />
              </div>
              <div className="memory-list-container">
                {filteredMemories.length === 0
                  ? (
                    <div className="settings-empty-hint">
                      暂无匹配的长期记忆项目
                    </div>
                  )
                  : (
                    filteredMemories.map((mem) => (
                      <div key={mem.id} className="memory-item-row">
                        <div className="memory-item-content">
                          <div className="memory-item-text">
                            🧠 {mem.content}
                          </div>
                          <div className="memory-item-meta-info">
                            <span>
                              类型: {mem.kind === "fact" ? "事实" : mem.kind}
                            </span>
                            <span style={{ marginLeft: 12 }}>
                              时间:{" "}
                              {new Date(mem.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <button
                          className="memory-del-btn"
                          onClick={async () => {
                            if (
                              await requestUiConfirm({
                                title: "删除长期记忆",
                                message:
                                  "确认删除该条记忆吗？这会影响智能体以后对该信息的认知。",
                                confirmLabel: "确认删除",
                                tone: "danger",
                              })
                            ) {
                              await deleteMemory(mem.id);
                            }
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  )}
              </div>
            </div>
          </div>
        );

      case "agent":
        return (
          <div className="settings-tab-content">
            <h2 className="settings-content-title">智能体设置</h2>
            <div className="settings-section">
              {/* 系统提示词 */}
              <div className="settings-item-card col-layout">
                <div className="settings-item-meta">
                  <label className="settings-item-title">
                    系统提示词 (System Prompt)
                  </label>
                  <p className="settings-item-desc">
                    配置智能体运行时的全局系统提示词，用来定义智能体的角色、口吻和安全规则。
                  </p>
                </div>
                <textarea
                  className="settings-textarea"
                  style={{
                    marginTop: 8,
                    height: 120,
                    width: "100%",
                    resize: "vertical",
                  }}
                  value={settings.agentSystemPrompt || ""}
                  onChange={(e) =>
                    updateSettings({ agentSystemPrompt: e.target.value })}
                  placeholder="请输入系统提示词..."
                />
              </div>

              {/* 模型温度 */}
              <div className="settings-item-card col-layout">
                <div className="settings-item-meta">
                  <label className="settings-item-title">
                    模型温度 (Temperature: {settings.agentTemperature || "0.7"})
                  </label>
                  <p className="settings-item-desc">
                    较高的温度值会使输出更有创意，较低的值更具确定性和精确性。
                  </p>
                </div>
                <div
                  className="settings-item-control slider-wrapper"
                  style={{ marginTop: 8 }}
                >
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    className="settings-slider"
                    value={parseFloat(settings.agentTemperature || "0.7")}
                    onChange={(e) =>
                      updateSettings({ agentTemperature: e.target.value })}
                  />
                  <div className="slider-ticks">
                    <span>确定性 (0.0)</span>
                    <span>平衡 (1.0)</span>
                    <span>创意性 (2.0)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case "model":
        return (
          <div className="settings-tab-content">
            <div
              className="settings-header-row"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <div>
                <h2
                  className="settings-content-title"
                  style={{ marginBottom: 4 }}
                >
                  模型配置中心
                </h2>
                <p
                  className="settings-section-desc"
                  style={{ color: "var(--text-2)", margin: 0, fontSize: 13 }}
                >
                  配置主流云端 AI 模型、本地 Ollama 引擎及自定义 OpenAI 规范
                  API。支持 ChatGPT 订阅授权；API Key 保存在本地钥匙串，订阅凭据由 Pi 在本机管理。
                </p>
              </div>
              <button
                className="settings-btn btn-primary"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  whiteSpace: "nowrap",
                }}
                onClick={() => {
                  setCustomForm({
                    name: "",
                    baseUrl: "https://api.openai.com/v1",
                    apiKey: "",
                    models: "",
                    modelLimits: {},
                  });
                  openCustomModal();
                }}
              >
                <Plus size={14} />
                添加自定义 API
              </button>
            </div>

            <div className="settings-section">
              {/* 默认模型配置卡片 */}
              <div className="security-card-box full-width">
                <h3
                  className="security-card-title"
                  style={{ marginBottom: 12 }}
                >
                  默认模型与默认渠道
                </h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 16,
                  }}
                >
                  <div>
                    <label
                      className="settings-item-title"
                      style={{
                        fontSize: 12.5,
                        display: "block",
                        marginBottom: 6,
                      }}
                    >
                      默认模型提供商
                    </label>
                    <select
                      className="settings-select"
                      style={{ width: "100%" }}
                      value={selectedDefaultProvider?.id || ""}
                      disabled={!hasConfiguredDefaultProviders}
                      onChange={(e) => {
                        const provider = configuredDefaultProviders.find(
                          (item: any) => item.id === e.target.value,
                        );
                        void updateSettings({
                          defaultProvider: provider?.id || "",
                          defaultModelId: provider?.models?.[0]?.id || "",
                        });
                      }}
                    >
                      <option value="">
                        {hasConfiguredDefaultProviders
                          ? "请选择默认模型提供商"
                          : "请先配置模型"}
                      </option>
                      {configuredDefaultProviders.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name || p.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      className="settings-item-title"
                      style={{
                        fontSize: 12.5,
                        display: "block",
                        marginBottom: 6,
                      }}
                    >
                      默认模型 ID
                    </label>
                    <select
                      className="settings-select"
                      style={{ width: "100%" }}
                      value={selectedDefaultModels.some((model: any) =>
                          model.id === settings.defaultModelId)
                        ? settings.defaultModelId
                        : ""}
                      disabled={!selectedDefaultProvider}
                      onChange={(e) =>
                        void updateSettings({ defaultModelId: e.target.value })}
                    >
                      <option value="">
                        {selectedDefaultProvider
                          ? "请选择默认模型"
                          : "请先配置模型"}
                      </option>
                      {selectedDefaultModels.map((m: any) => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.id}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* 本地 Ollama 配置卡片 */}
              <div
                className="security-card-box full-width"
                style={{ marginTop: 16 }}
              >
                <div
                  className="security-card-header"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div
                    className="security-card-title-group"
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ fontSize: 18 }}>🦙</span>
                    <h3 className="security-card-title" style={{ margin: 0 }}>
                      Ollama 本地大模型
                    </h3>
                    <span
                      className={`log-status-badge ${
                        ollamaStatus?.running ? "success" : "error"
                      }`}
                    >
                      {ollamaStatus?.loading
                        ? "检测中..."
                        : ollamaStatus?.running
                        ? `服务在线 (${ollamaStatus.latencyMs || 0}ms)`
                        : "未连接"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="settings-btn"
                      onClick={async () => {
                        const res = await fetchOllamaModels();
                        setOllamaStatus(res);
                      }}
                    >
                      刷新本地模型
                    </button>
                    <button
                      className="settings-btn"
                      onClick={async () => {
                        const res = await testConnection({
                          provider: "ollama",
                          baseUrl: settings.ollamaBaseUrl,
                        });
                        setTestResults((prev) => ({ ...prev, ollama: res }));
                      }}
                    >
                      测试连通性
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div
                    className="settings-item-meta"
                    style={{ marginBottom: 6 }}
                  >
                    <label
                      className="settings-item-title"
                      style={{ fontSize: 12.5 }}
                    >
                      Ollama 服务地址 (Base URL)
                    </label>
                  </div>
                  <div
                    className="settings-input-row"
                    style={{ display: "flex", gap: 8 }}
                  >
                    <input
                      type="text"
                      className="settings-input"
                      style={{ flex: 1 }}
                      value={settings.ollamaBaseUrl || "http://127.0.0.1:11434"}
                      onChange={(e) =>
                        updateSettings({ ollamaBaseUrl: e.target.value })}
                      placeholder="http://127.0.0.1:11434"
                    />
                    <button
                      className="settings-btn"
                      onClick={() =>
                        updateSettings({
                          ollamaBaseUrl: "http://127.0.0.1:11434",
                        })}
                    >
                      恢复默认
                    </button>
                  </div>
                </div>

                {testResults.ollama && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: testResults.ollama.ok
                        ? "var(--green)"
                        : "var(--red)",
                    }}
                  >
                    {testResults.ollama.ok
                      ? `✓ ${testResults.ollama.message}`
                      : `✗ ${testResults.ollama.error}`}
                  </div>
                )}

                {/* 已查找到的 Ollama 模型列表 */}
                <div style={{ marginTop: 12 }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-2)",
                      fontWeight: 600,
                    }}
                  >
                    已侦测到的本地模型
                    ({settings.providers?.find((p: any) => p.id === "ollama")
                      ?.models?.length || 0})：
                  </span>
                  <div
                    className="provider-models-tags"
                    style={{
                      marginTop: 6,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    {settings.providers
                      ?.find((p: any) => p.id === "ollama")
                      ?.models?.map((m: any) => (
                        <span
                          key={m.id}
                          className="model-tag-item"
                          title="点击设为当前对话模型"
                          onClick={() => {
                            useStore.setState({
                              modelProvider: "ollama",
                              modelId: m.id,
                            });
                            updateSettings({
                              defaultProvider: "ollama",
                              defaultModelId: m.id,
                            });
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          🦙 {m.id} {m.size ? `(${m.size})` : ""}
                        </span>
                      ))}
                  </div>
                </div>
              </div>

              {/* 自定义 OpenAI 提供商卡片列表 */}
              {settings.customProviders &&
                settings.customProviders.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <h3
                    className="settings-section-subtitle"
                    style={{
                      marginBottom: 12,
                      fontSize: 13.5,
                      color: "var(--text-2)",
                    }}
                  >
                    自定义 OpenAI 规范端点 ({settings.customProviders.length})
                  </h3>
                  <div className="providers-grid">
                    {settings.customProviders.map((cp) => {
                      const isTesting = testingProvider === cp.id;
                      const testRes = testResults[cp.id];
                      return (
                        <div
                          key={cp.id}
                          className="provider-model-card configured"
                        >
                          <div className="provider-card-header">
                            <div>
                              <h4 className="provider-name">🔧 {cp.name}</h4>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "var(--text-3)",
                                  marginTop: 2,
                                }}
                              >
                                {cp.baseUrl}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                className="settings-btn text-xs"
                                style={{ padding: "3px 7px" }}
                                onClick={() => {
                                  setCustomForm({
                                    id: cp.id,
                                    name: cp.name,
                                    baseUrl: cp.baseUrl,
                                    apiKey: "",
                                    models: (cp.models || []).join(", "),
                                    modelLimits: Object.fromEntries(
                                      Object.entries(cp.modelLimits ?? {}).map((
                                        [modelId, limits],
                                      ) => [modelId, {
                                        contextWindow: tokensToK(
                                          limits.contextWindow,
                                        ),
                                        maxOutputTokens: tokensToK(
                                          limits.maxOutputTokens,
                                        ),
                                      }]),
                                    ),
                                  });
                                  openCustomModal();
                                }}
                              >
                                编辑
                              </button>
                              <button
                                className="settings-btn danger text-xs"
                                style={{ padding: "3px 7px" }}
                                onClick={() => deleteCustomProvider(cp.id)}
                              >
                                删除
                              </button>
                            </div>
                          </div>
                          <div
                            className="provider-models-tags"
                            style={{ marginTop: 8 }}
                          >
                            {cp.models?.map((m) => (
                              <span key={m} className="model-tag-item">
                                {m}
                              </span>
                            ))}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              marginTop: 8,
                            }}
                          >
                            <button
                              className="settings-btn text-xs"
                              disabled={isTesting}
                              onClick={async () => {
                                setTestingProvider(cp.id);
                                const res = await testConnection({
                                  provider: cp.id,
                                  baseUrl: cp.baseUrl,
                                });
                                setTestResults((prev) => ({
                                  ...prev,
                                  [cp.id]: res,
                                }));
                                setTestingProvider(null);
                              }}
                            >
                              {isTesting ? "测试中..." : "测试连通性"}
                            </button>
                            {testRes && (
                              <span
                                style={{
                                  fontSize: 11,
                                  color: testRes.ok
                                    ? "var(--green)"
                                    : "var(--red)",
                                }}
                              >
                                {testRes.ok
                                  ? `✓ ${testRes.latencyMs || 0}ms`
                                  : `✗ 失败`}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 主流云端大模型服务商 */}
              <div
                className="models-providers-section"
                style={{ marginTop: 20 }}
              >
                <h3
                  className="settings-section-subtitle"
                  style={{
                    marginBottom: 12,
                    fontSize: 13.5,
                    color: "var(--text-2)",
                  }}
                >
                  云端模型服务商与认证
                </h3>
                <div className="providers-grid">
                  {settings.providers
                    ?.filter((p: any) => p.id !== "ollama" && !p.isCustom)
                    .map((provider: any) => {
                      const subscription = provider.id === "openai" && settings.openaiSubscription === true;
                      const authMode = openAIAuthMode ?? (subscription || !apiKeys.openai ? "oauth" : "api_key");
                      const subscriptionMode = provider.id === "openai" && authMode === "oauth";
                      const hasKey = subscriptionMode ? subscription : !!apiKeys[provider.id];
                      const val = subscriptionMode ? "" : keysInput[provider.id] || "";
                      const isShowing = !!showKey[provider.id];
                      const isTesting = testingProvider === provider.id;
                      const testRes = testResults[provider.id];
                      const supportsOfficialCatalog = OFFICIAL_CATALOG_PROVIDER_IDS.has(
                        provider.id,
                      );
                      const providerCatalog = providerCatalogs[provider.id] || [];
                      const providerCatalogError = providerCatalogErrors[provider.id];
                      const isLoadingCatalog = loadingCatalogProvider === provider.id;
                      const selectedModelId = selectedProviderModels[provider.id] ||
                        provider.models?.[0]?.id || "";
                      const pendingManualModelId = (newModelInputs[provider.id] || "").trim();
                      const modelToSave = pendingManualModelId || selectedModelId;

                      return (
                        <div
                          key={provider.id}
                          className={`provider-model-card ${
                            hasKey ? "configured" : "unconfigured"
                          }`}
                        >
                          <div className="provider-card-header">
                            <h4 className="provider-name">
                              <span>
                                {provider.id === "deepseek"
                                  ? "⚡"
                                  : provider.id === "zhipu"
                                  ? "🧠"
                                  : provider.id === "moonshot"
                                  ? "🌙"
                                  : provider.id === "openai"
                                  ? "🤖"
                                  : provider.id === "anthropic"
                                  ? "🔮"
                                  : provider.id === "google"
                                  ? "🌐"
                                  : provider.id === "qwen"
                                  ? "🌟"
                                  : "🔹"}
                              </span>
                              <span>{provider.name}</span>
                            </h4>
                            <span
                              className={`provider-status-badge ${
                                hasKey ? "ok" : "warn"
                              }`}
                            >
                              {hasKey ? "已就绪" : "未配置"}
                            </span>
                          </div>

                          {provider.id === "openai" && <OpenAISubscriptionControls mode={authMode} onMode={setOpenAIAuthMode} />}
                          {/* API Key 密码卡片 */}
                          <div
                            className="settings-input-password-wrapper"
                            style={{ marginTop: 6, display: subscriptionMode ? "none" : undefined }}
                          >
                            <input
                              type={isShowing ? "text" : "password"}
                              className="settings-input"
                              placeholder={hasKey
                                ? "••••••••••••••••••••••••"
                                : "输入 API Key"}
                              value={val}
                              onChange={(e) =>
                                setKeysInput({
                                  ...keysInput,
                                  [provider.id]: e.target.value,
                                })}
                              onBlur={() => {
                                if (
                                  supportsOfficialCatalog &&
                                  val.trim() &&
                                  providerCatalog.length === 0
                                ) {
                                  void loadProviderCatalog(provider.id, val);
                                }
                              }}
                            />
                            <button
                              className="settings-eye-btn"
                              onClick={() =>
                                setShowKey({
                                  ...showKey,
                                  [provider.id]: !isShowing,
                                })}
                              title={isShowing ? "隐藏" : "显示"}
                            >
                              {isShowing
                                ? <EyeOff size={13} />
                                : <Eye size={13} />}
                            </button>
                          </div>

                          {/* 自定义模型 ID 编辑区 */}
                          <div style={{ marginTop: 10 }}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 6,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "var(--text-3)",
                                  fontWeight: 500,
                                }}
                              >
                                已添加模型 ({provider.models?.length || 0})：
                              </span>
                            </div>

                            {supportsOfficialCatalog && (
                              <div style={{ marginBottom: 8 }}>
                                <div
                                  style={{
                                    display: "flex",
                                    gap: 6,
                                    alignItems: "center",
                                  }}
                                >
                                  <select
                                    className="settings-select text-xs"
                                    style={{ flex: 1, height: 30 }}
                                    value={selectedModelId}
                                    onFocus={() => {
                                      if (
                                        providerCatalog.length === 0 &&
                                        !val.trim() &&
                                        hasKey
                                      ) {
                                        void loadProviderCatalog(provider.id);
                                      }
                                    }}
                                    onChange={(e) => {
                                      setSelectedProviderModels((current) => ({
                                        ...current,
                                        [provider.id]: e.target.value,
                                      }));
                                      setNewModelInputs((current) => ({
                                        ...current,
                                        [provider.id]: "",
                                      }));
                                    }}
                                  >
                                    <option value="">
                                      {isLoadingCatalog
                                        ? "正在从第三方官方 API 获取模型…"
                                        : providerCatalog.length > 0
                                        ? "选择官方模型…"
                                        : val.trim() || hasKey
                                        ? "点击加载官方模型…"
                                        : subscriptionMode ? "登录 ChatGPT 后选择模型…" : "输入 API Key 后点击加载模型…"}
                                    </option>
                                    {(provider.models || [])
                                      .filter((configured: any) =>
                                        !providerCatalog.some((item: any) =>
                                          item.id === configured.id)
                                      )
                                      .map((configured: any) => (
                                        <option key={configured.id} value={configured.id}>
                                          {configured.name || configured.id} · {configured.id}
                                        </option>
                                      ))}
                                    {providerCatalog.map((model: any) => {
                                      const added = provider.models?.some(
                                        (item: any) => item.id === model.id,
                                      );
                                      return (
                                        <option
                                          key={model.id}
                                          value={model.id}
                                        >
                                          {model.name || model.id} · {model.id}
                                          {added ? "（已保存）" : ""}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </div>
                                {providerCatalogError && (
                                  <div
                                    style={{
                                      marginTop: 5,
                                      color: "var(--red)",
                                      fontSize: 11,
                                    }}
                                  >
                                    {providerCatalogError}
                                  </div>
                                )}
                              </div>
                            )}

                            {provider.id === "zhipu" && (
                              <div style={{ marginBottom: 8, color: "var(--text-3)", fontSize: 11 }}>
                                智谱官方暂未公开模型列表 API，请在下方手动填写模型 ID。
                              </div>
                            )}
                            {provider.id === "zeroone" && (
                              <div style={{ marginBottom: 8, color: "var(--text-3)", fontSize: 11 }}>
                                零一万物开放平台正在停止 API 服务，请迁移渠道或手动维护模型 ID。
                              </div>
                            )}

                            <div
                              className="provider-models-tags"
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 5,
                                marginBottom: 8,
                              }}
                            >
                              {provider.models && provider.models.length > 0
                                ? (
                                  provider.models.map((m: any) => (
                                    <span
                                      key={m.id}
                                      className="model-tag-item"
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 5,
                                        padding: "3px 8px",
                                        background: "var(--bg)",
                                        borderRadius: 6,
                                        fontSize: 11.5,
                                        border: "1px solid var(--border-soft)",
                                        color: "var(--text-2)",
                                      }}
                                    >
                                      <span>{m.name || m.id}</span>
                                      <X
                                        size={11}
                                        style={{
                                          cursor: "pointer",
                                          opacity: 0.5,
                                          transition: "opacity .12s",
                                        }}
                                        onClick={() =>
                                          deleteModelFromProvider(
                                            provider.id,
                                            m.id,
                                          )}
                                      />
                                    </span>
                                  ))
                                )
                                : (
                                  <span
                                    style={{
                                      fontSize: 11.5,
                                      color: "var(--text-3)",
                                      fontStyle: "italic",
                                      padding: "2px 0",
                                    }}
                                  >
                                    暂无模型，请从官方下拉框选择或手动添加
                                  </span>
                                )}
                            </div>

                            {/* 官方列表缺失时的手动模型 ID 备用输入 */}
                            <div
                              style={{ display: "flex", gap: 6, marginTop: 4 }}
                            >
                              <input
                                type="text"
                                className="settings-input text-xs"
                                style={{
                                  flex: 1,
                                  padding: "4px 8px",
                                  height: 30,
                                }}
                                placeholder={`列表无此模型时手动输入（保存模型时一并保存，如: ${
                                  provider.id === "deepseek"
                                    ? "deepseek-v4-flash"
                                    : provider.id === "openai"
                                    ? "gpt-4o"
                                    : provider.id === "anthropic"
                                    ? "claude-3-5-sonnet-20241022"
                                    : "model-id"
                                }）`}
                                value={newModelInputs[provider.id] || ""}
                                onChange={(e) =>
                                  setNewModelInputs({
                                    ...newModelInputs,
                                    [provider.id]: e.target.value,
                                  })}
                              />
                            </div>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              marginTop: 10,
                              paddingTop: 6,
                              borderTop: "1px solid var(--border-soft)",
                            }}
                          >
                            <button
                              className="settings-btn btn-primary text-xs"
                              style={{ flex: 1, height: 30 }}
                              disabled={(!hasKey && !val.trim()) || !modelToSave}
                              onClick={async () => {
                                try {
                                  if (val.trim()) {
                                    await saveApiKey(provider.id, val);
                                  }
                                  const catalogModel = providerCatalog.find(
                                    (item: any) => item.id === modelToSave,
                                  );
                                  const newProviders = (settings.providers || []).map(
                                    (item: any) => {
                                      if (item.id !== provider.id) return item;
                                      const existingModels = item.models || [];
                                      if (existingModels.some((model: any) =>
                                        model.id === modelToSave)) {
                                        return {
                                          ...item,
                                          models: existingModels.map((model: any) =>
                                            model.id === modelToSave
                                              ? {
                                                ...model,
                                                name: catalogModel?.name ||
                                                  model.name || modelToSave,
                                                ...(catalogModel?.contextWindow
                                                  ? {
                                                    contextWindow:
                                                      catalogModel.contextWindow,
                                                  }
                                                  : {}),
                                              }
                                              : model
                                          ),
                                        };
                                      }
                                      return {
                                        ...item,
                                        models: [...existingModels, {
                                          id: modelToSave,
                                          name: catalogModel?.name || modelToSave,
                                          ...(catalogModel?.contextWindow
                                            ? { contextWindow: catalogModel.contextWindow }
                                            : {}),
                                        }],
                                      };
                                    },
                                  );
                                  await updateSettings({ providers: newProviders });
                                  setKeysInput((prev) => ({
                                    ...prev,
                                    [provider.id]: "",
                                  }));
                                  setNewModelInputs((prev) => ({
                                    ...prev,
                                    [provider.id]: "",
                                  }));
                                  setSelectedProviderModels((prev) => ({
                                    ...prev,
                                    [provider.id]: modelToSave,
                                  }));
                                  setTestResults((prev) => ({
                                    ...prev,
                                    [provider.id]: {
                                      ok: true,
                                      message: subscriptionMode ? "模型已保存" : "模型与 Key 已保存",
                                    },
                                  }));
                                } catch (error) {
                                  setTestResults((prev) => ({
                                    ...prev,
                                    [provider.id]: {
                                      ok: false,
                                      error: `保存失败：${
                                        error instanceof Error
                                          ? error.message
                                          : String(error)
                                      }`,
                                    },
                                  }));
                                }
                              }}
                            >
                              {subscriptionMode ? "保存模型" : "保存模型与 Key"}
                            </button>
                            <button
                              className="settings-btn text-xs"
                              style={{ height: 30 }}
                              disabled={isTesting || (!hasKey && !val.trim()) || !modelToSave}
                              onClick={async () => {
                                setTestingProvider(provider.id);
                                const res = await testConnection({
                                  provider: provider.id,
                                  apiKey: val || undefined,
                                  modelId: modelToSave,
                                });
                                setTestResults((prev) => ({
                                  ...prev,
                                  [provider.id]: res,
                                }));
                                setTestingProvider(null);
                              }}
                            >
                              {isTesting ? "测试中..." : "测试连接"}
                            </button>
                            {hasKey && !subscriptionMode && (
                              <button
                                className="settings-btn danger text-xs"
                                style={{ height: 30 }}
                                onClick={() => deleteApiKey(provider.id)}
                              >
                                清除
                              </button>
                            )}
                          </div>

                          {testRes && (
                            <div
                              style={{
                                marginTop: 4,
                                fontSize: 11,
                                color: testRes.ok ? "#10B981" : "#EF4444",
                              }}
                            >
                              {testRes.ok
                                ? `✓ ${testRes.message}`
                                : `✗ ${testRes.error}`}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* 自定义 Provider 添加/编辑弹窗 */}
            {customModalOpen && (
              <div className="cmd-palette-backdrop" style={{ zIndex: 1000 }}>
                <div
                  className="cmd-palette-modal"
                  style={{
                    padding: 20,
                    maxWidth: 480,
                    // 背景层顶部留了 12vh，弹窗高度不超过剩余视口，内容区内部滚动
                    maxHeight: "calc(88vh - 24px)",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 16,
                    }}
                  >
                    <h3
                      style={{ margin: 0, fontSize: 16, color: "var(--text)" }}
                    >
                      {customForm.id
                        ? "编辑自定义 OpenAI API"
                        : "添加自定义 OpenAI API"}
                    </h3>
                    <button
                      className="settings-eye-btn"
                      onClick={() =>
                        setCustomModalOpen(false)}
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                      flex: 1,
                      minHeight: 0,
                      overflowY: "auto",
                      // 给输入框聚焦描边留出空间，避免被滚动容器裁掉
                      padding: 2,
                      margin: -2,
                    }}
                  >
                    <div>
                      <label
                        className="settings-item-title"
                        style={{
                          fontSize: 12,
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        提供商名称 (Provider Name)
                      </label>
                      <input
                        type="text"
                        className="settings-input w-full"
                        placeholder="例如: 硅基流动 / 公司代理"
                        value={customForm.name}
                        onChange={(e) =>
                          setCustomForm({
                            ...customForm,
                            name: e.target.value,
                          })}
                      />
                    </div>
                    <div>
                      <label
                        className="settings-item-title"
                        style={{
                          fontSize: 12,
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        Base URL (兼容 OpenAI /v1 端点)
                      </label>
                      <input
                        type="text"
                        className="settings-input w-full"
                        placeholder="例如: https://api.siliconflow.cn/v1"
                        value={customForm.baseUrl}
                        onChange={(e) =>
                          setCustomForm({
                            ...customForm,
                            baseUrl: e.target.value,
                          })}
                      />
                    </div>
                    <div>
                      <label
                        className="settings-item-title"
                        style={{
                          fontSize: 12,
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        API Key (可选)
                      </label>
                      <input
                        type="password"
                        className="settings-input w-full"
                        placeholder="sk-..."
                        value={customForm.apiKey}
                        onChange={(e) =>
                          setCustomForm({
                            ...customForm,
                            apiKey: e.target.value,
                          })}
                      />
                    </div>
                    <div>
                      <label
                        className="settings-item-title"
                        style={{
                          fontSize: 12,
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        可用模型列表 (英文逗号分隔，或点击"获取模型"勾选)
                      </label>
                      <div style={{ display: "flex", gap: 6 }}>
                      <input
                        type="text"
                        className="settings-input w-full"
                        placeholder="例如: deepseek-ai/DeepSeek-V3, Qwen/Qwen2.5-Coder-32B-Instruct"
                        value={customForm.models}
                        onChange={(e) =>
                          setCustomForm({
                            ...customForm,
                            models: e.target.value,
                          })}
                      />
                      <button
                        className="settings-btn text-xs"
                        style={{ whiteSpace: "nowrap" }}
                        disabled={customCatalogLoading ||
                          !customForm.baseUrl.trim()}
                        onClick={async () => {
                          setCustomCatalogLoading(true);
                          setCustomCatalogError("");
                          const res = await fetchCustomProviderModels({
                            id: customForm.id,
                            baseUrl: customForm.baseUrl,
                            apiKey: customForm.apiKey,
                          });
                          setCustomCatalogLoading(false);
                          if (res.ok && res.models) {
                            setCustomCatalog(res.models);
                            if (res.models.length === 0) {
                              setCustomCatalogError("该渠道没有返回任何模型");
                            }
                          } else {
                            setCustomCatalog([]);
                            setCustomCatalogError(res.error || "获取模型失败");
                          }
                        }}
                      >
                        {customCatalogLoading ? "获取中..." : "获取模型"}
                      </button>
                      </div>
                      {customCatalogError && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--red)",
                            marginTop: 4,
                          }}
                        >
                          {customCatalogError}
                        </div>
                      )}
                      {customCatalog.length > 0 && (() => {
                        const selected = new Set(
                          parseCustomModelIds(customForm.models),
                        );
                        const keyword = customCatalogFilter.trim().toLowerCase();
                        const visible = keyword
                          ? customCatalog.filter((m) =>
                            m.id.toLowerCase().includes(keyword)
                          )
                          : customCatalog;
                        const toggle = (model: typeof customCatalog[number]) => {
                          const ids = parseCustomModelIds(customForm.models);
                          if (selected.has(model.id)) {
                            setCustomForm({
                              ...customForm,
                              models: ids.filter((id) => id !== model.id)
                                .join(", "),
                            });
                            return;
                          }
                          const current = customForm.modelLimits[model.id];
                          setCustomForm({
                            ...customForm,
                            models: [...ids, model.id].join(", "),
                            // 只在用户没填过时用接口返回的容量预填
                            modelLimits: current?.contextWindow ||
                                current?.maxOutputTokens
                              ? customForm.modelLimits
                              : {
                                ...customForm.modelLimits,
                                [model.id]: {
                                  contextWindow: tokensToK(model.contextWindow),
                                  maxOutputTokens: tokensToK(
                                    model.maxOutputTokens,
                                  ),
                                },
                              },
                          });
                        };
                        return (
                          <div style={{ marginTop: 6 }}>
                            {customCatalog.length > 8 && (
                              <input
                                type="text"
                                className="settings-input w-full"
                                placeholder={`搜索模型（共 ${customCatalog.length} 个）`}
                                value={customCatalogFilter}
                                onChange={(e) =>
                                  setCustomCatalogFilter(e.target.value)}
                                style={{ marginBottom: 4 }}
                              />
                            )}
                            <div
                              style={{
                                maxHeight: 160,
                                overflowY: "auto",
                                border: "1px solid var(--border)",
                                borderRadius: 6,
                                padding: "4px 8px",
                                fontSize: 12,
                              }}
                            >
                              {visible.map((model) => (
                                <label
                                  key={model.id}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "3px 0",
                                    cursor: "pointer",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selected.has(model.id)}
                                    onChange={() => toggle(model)}
                                  />
                                  <span
                                    style={{
                                      flex: 1,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                    title={model.id}
                                  >
                                    {model.id}
                                  </span>
                                  {(model.contextWindow ||
                                    model.maxOutputTokens) && (
                                    <span style={{ color: "var(--text-3)" }}>
                                      {model.contextWindow
                                        ? `${tokensToK(model.contextWindow)}K`
                                        : "-"} /{" "}
                                      {model.maxOutputTokens
                                        ? `${tokensToK(model.maxOutputTokens)}K`
                                        : "-"}
                                    </span>
                                  )}
                                </label>
                              ))}
                              {visible.length === 0 && (
                                <div style={{ color: "var(--text-3)", padding: "3px 0" }}>
                                  没有匹配的模型
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {parseCustomModelIds(customForm.models).length > 0 && (
                      <div>
                        <label
                          className="settings-item-title"
                          style={{
                            fontSize: 12,
                            display: "block",
                            marginBottom: 4,
                          }}
                        >
                          模型容量（单位 K，1K = 1000 tokens；留空使用默认值：上下文 32.768K / 最大输出 4.096K）
                        </label>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(0, 1fr) 110px 110px",
                            gap: 6,
                            alignItems: "center",
                            fontSize: 12,
                          }}
                        >
                          <span style={{ color: "var(--text-3)" }}>模型</span>
                          <span style={{ color: "var(--text-3)" }}>上下文窗口 (K)</span>
                          <span style={{ color: "var(--text-3)" }}>最大输出 (K)</span>
                          {parseCustomModelIds(customForm.models).map((modelId) => {
                            const limits = customForm.modelLimits[modelId] ??
                              { contextWindow: "", maxOutputTokens: "" };
                            const update = (
                              field: keyof CustomModelLimitsInput,
                              value: string,
                            ) =>
                              setCustomForm({
                                ...customForm,
                                modelLimits: {
                                  ...customForm.modelLimits,
                                  [modelId]: { ...limits, [field]: value },
                                },
                              });
                            return (
                              <div key={modelId} style={{ display: "contents" }}>
                                <span
                                  title={modelId}
                                  style={{
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {modelId}
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  className="settings-input"
                                  placeholder="32.768"
                                  value={limits.contextWindow}
                                  onChange={(e) =>
                                    update("contextWindow", e.target.value)}
                                />
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  className="settings-input"
                                  placeholder="4.096"
                                  value={limits.maxOutputTokens}
                                  onChange={(e) =>
                                    update("maxOutputTokens", e.target.value)}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 8,
                      marginTop: 20,
                      flexShrink: 0,
                    }}
                  >
                    <button
                      className="settings-btn"
                      onClick={() =>
                        setCustomModalOpen(false)}
                    >
                      取消
                    </button>
                    <button
                      className="settings-btn btn-primary"
                      disabled={!customForm.name.trim() ||
                        !customForm.baseUrl.trim()}
                      onClick={async () => {
                        await saveCustomProvider({
                          ...customForm,
                          modelLimits: customModelLimitsPayload(customForm),
                        });
                        setCustomModalOpen(false);
                      }}
                    >
                      保存
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case "help":
        return (
          <div className="settings-tab-content">
            <h2 className="settings-content-title">帮助与反馈</h2>
            <div className="settings-section help-section">
              <div className="app-logo-section">
                <PiLogo size={64} style={{ marginBottom: 12 }} />
                <h3 className="app-name-large">PiCoddy Desktop</h3>
                <p className="app-version-txt">版本 <AppVersion /></p>
              </div>
              <UpdatePanel />
              <p className="copyright-txt">picoddy 版权所有</p>
            </div>
          </div>
        );
    }
  };

  return (
    <div
      className="settings-modal-overlay"
      onMouseDown={() => setShowSettings(false)}
    >
      <div
        className="settings-modal-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <span className="settings-modal-title">设置</span>
          <button
            className="settings-modal-close"
            onClick={() => setShowSettings(false)}
          >
            <X size={16} />
          </button>
        </div>
        <div className="settings-modal-body">
          {renderSidebar()}
          <div className="settings-content-area">{renderContent()}</div>
        </div>
      </div>
    </div>
  );
}
