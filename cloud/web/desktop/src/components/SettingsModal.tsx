import CloudModelCreate from "./CloudModelCreate";
import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";
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
  { id: "model", label: "模型与 API 渠道", icon: Sparkles },
  { id: "computer_use", label: "云端执行环境", icon: Laptop },
  { id: "memory", label: "长期记忆", icon: Brain },
  { id: "agent", label: "智能体设置", icon: Cpu },
  { id: "system", label: "常规与快捷键", icon: Settings },
  { id: "help", label: "帮助与版本", icon: Settings },
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

function connectionSuccessMessage(result: any): string {
  if (typeof result?.message === "string" && result.message.trim()) return result.message;
  return typeof result?.latencyMs === "number"
    ? `连接成功 (${result.latencyMs}ms)`
    : "连接成功";
}

const RESOURCE_MODEL_PREFIX = "resource:";

function modelSelectionValue(model: any): string {
  return model?.resourceId
    ? `${RESOURCE_MODEL_PREFIX}${model.resourceId}`
    : String(model?.id ?? "");
}

function resourceIdFromModelSelection(value: string): string | undefined {
  return value.startsWith(RESOURCE_MODEL_PREFIX)
    ? value.slice(RESOURCE_MODEL_PREFIX.length)
    : undefined;
}

export default function SettingsModal() {
  const {
    showSettings,
    setShowSettings,
    settings,
    updateSettings,
    apiKeys,
    saveApiKey,
    memories,
    loadMemories,
    deleteMemory,
    requestUiConfirm,
    testConnection,
    saveCustomProvider,
    deleteCustomProvider,
    fetchOllamaModels,
    fetchProviderModels,
  } = useStore();

  const [activeTab, setActiveTab] = useState<TabId>("model");

  // State for API keys form
  const [keysInput, setKeysInput] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  // State for Model tab testing & custom forms
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [customForm, setCustomForm] = useState<
    {
      id?: string;
      name: string;
      baseUrl: string;
      apiKey: string;
      models: string;
    }
  >({
    name: "",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    models: "",
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

  const loadProviderCatalog = async (providerId: string, inputApiKey?: string) => {
    if (loadingCatalogProvider === providerId) return;
    if (!inputApiKey?.trim() && !apiKeys[providerId]) {
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
    const provider = (settings.providers || []).find((item: any) => item.id === providerId);
    const selectedResourceId = resourceIdFromModelSelection(
      selectedProviderModels[providerId] || "",
    );
    const configuredResources = (provider?.models || [])
      .map((model: any) => model.resourceId)
      .filter(Boolean);
    const resourceId = inputApiKey?.trim()
      ? undefined
      : selectedResourceId || (configuredResources.length === 1 ? configuredResources[0] : undefined);
    if (!inputApiKey?.trim() && !resourceId) {
      setProviderCatalogErrors((current) => ({
        ...current,
        [providerId]: "该渠道有多个已保存模型，请先选择一个模型资源",
      }));
      setLoadingCatalogProvider(null);
      return;
    }
    const result = await fetchProviderModels(providerId, inputApiKey, resourceId);
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


  // Load memories and settings keys on mount
  useEffect(() => {
    if (showSettings) {
      useStore.getState().loadSettings();
      if (activeTab === "memory") {
        loadMemories();
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
  const presetDefaultProviders = (settings.providers || []).filter(
    (provider: any) =>
      Array.isArray(provider.models) && provider.models.length > 0 &&
      (provider.id === "ollama" || provider.isCustom === true || provider.models.some((model: any) => model.isVirtual) || apiKeys[provider.id]),
  );
  const customDefaultProviders = (settings.customProviders || [])
    .filter((provider: any) => provider.apiKeyConfigured !== false && provider.models?.[0])
    .map((provider: any) => ({
      id: provider.id,
      name: provider.name,
      provider: provider.provider || "openai",
      isCustom: true,
      models: [{
        id: provider.models[0],
        name: provider.models[0],
        resourceId: provider.id,
      }],
    }));
  const configuredDefaultProviders = [
    ...presetDefaultProviders,
    ...customDefaultProviders,
  ];
  const selectedDefaultProvider = configuredDefaultProviders.find(
    (provider: any) => settings.defaultModelResourceId
      ? provider.models.some((model: any) =>
        model.resourceId === settings.defaultModelResourceId)
      : provider.id === settings.defaultProvider,
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
      case "computer_use":
        return <div className="settings-tab-content">
          <h2 className="settings-content-title">云端执行环境</h2>
          <div className="security-card-box full-width">
            <h3 className="security-card-title">OpenSandbox</h3>
            <p className="settings-section-desc">浏览器操作、命令和技能在任务隔离环境中执行，不需要本机辅助功能或屏幕录制权限。</p>
            <p className="settings-section-desc">运行镜像及浏览器依赖由管理员部署。实时远程桌面尚未接入。</p>
          </div>
        </div>;

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
                      checked={false}
                      disabled title="云端任务不依赖本机保持唤醒"
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
                    云端工作空间存储
                  </label>
                  <p className="settings-item-desc">
                    持久文件存储由管理员配置；每个任务使用隔离沙箱，不关联本机路径。
                  </p>
                </div>
                <div className="settings-input-row" style={{ marginTop: 8 }}>
                  <input
                    type="text"
                    className="settings-input"
                    value="服务端统一管理"
                    disabled
                    onChange={(e) =>
                      updateSettings({ defaultWorkspaceDir: e.target.value })}
                  />
                  <button
                    className="settings-btn"
                    onClick={handleBrowseWorkspaceDir}
                    disabled
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
                    云端尚未接入体验数据收集，此开关不可用。
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
                      checked={false}
                      disabled
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
                    云端工具由服务端配置，此偏好尚未接入。
                  </p>
                </div>
                <div className="settings-item-control">
                  <select
                    className="settings-select"
                    value={settings.searchEngine || "google"}
                    disabled
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
            <CloudModelCreate />
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
                  配置云端 AI 模型及兼容 OpenAI 的 API。仅支持手动 API Key；密钥在服务端加密保存，不写入浏览器存储，也不连接本机 Ollama。
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
                  });
                  setCustomModalOpen(true);
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
                        const model = provider?.models?.[0];
                        void updateSettings({
                          defaultProvider: provider?.provider || provider?.id || "",
                          defaultModelId: model?.id || "",
                          defaultModelResourceId: model?.resourceId || "",
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
                      value={settings.defaultModelResourceId && selectedDefaultModels.some(
                          (model: any) => model.resourceId === settings.defaultModelResourceId)
                        ? `${RESOURCE_MODEL_PREFIX}${settings.defaultModelResourceId}`
                        : selectedDefaultModels.some((model: any) =>
                          model.id === settings.defaultModelId)
                        ? settings.defaultModelId
                        : ""}
                      disabled={!selectedDefaultProvider}
                      onChange={(e) => {
                        const selectedValue = e.target.value;
                        const selectedResourceId = resourceIdFromModelSelection(selectedValue);
                        const model = selectedDefaultModels.find((item: any) =>
                          selectedResourceId
                            ? item.resourceId === selectedResourceId
                            : item.id === selectedValue,
                        );
                        void updateSettings({
                          defaultProvider: selectedDefaultProvider?.provider ||
                            selectedDefaultProvider?.id || "",
                          defaultModelId: model?.id || "",
                          defaultModelResourceId: model?.resourceId || "",
                        });
                      }}
                    >
                      <option value="">
                        {selectedDefaultProvider
                          ? "请选择默认模型"
                          : "请先配置模型"}
                      </option>
                      {selectedDefaultModels.map((m: any) => (
                          <option key={m.resourceId || m.id} value={modelSelectionValue(m)}>
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
                        ? typeof ollamaStatus.latencyMs === "number"
                          ? `服务在线 (${ollamaStatus.latencyMs}ms)`
                          : "服务在线"
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
                                  });
                                  setCustomModalOpen(true);
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
                                  provider: cp.provider || "openai",
                                  resourceId: cp.id,
                                  modelId: cp.models?.[0],
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
                                  ? `✓ ${connectionSuccessMessage(testRes)}`
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
                      const hasKey = !!apiKeys[provider.id];
                      const val = keysInput[provider.id] || "";
                      const isShowing = !!showKey[provider.id];
                      const isTesting = testingProvider === provider.id;
                      const testRes = testResults[provider.id];
                      const supportsOfficialCatalog = OFFICIAL_CATALOG_PROVIDER_IDS.has(
                        provider.id,
                      );
                      const providerCatalog = providerCatalogs[provider.id] || [];
                      const providerCatalogError = providerCatalogErrors[provider.id];
                      const isLoadingCatalog = loadingCatalogProvider === provider.id;
                      const configuredModels = provider.models || [];
                      const selectedModelValue = selectedProviderModels[provider.id] ??
                        (configuredModels.length === 1
                          ? modelSelectionValue(configuredModels[0])
                          : "");
                      const selectedResourceId = resourceIdFromModelSelection(selectedModelValue);
                      const configuredModel = selectedResourceId
                        ? configuredModels.find((model: any) =>
                          model.resourceId === selectedResourceId)
                        : undefined;
                      const pendingManualModelId = (newModelInputs[provider.id] || "").trim();
                      const modelToSave = pendingManualModelId ||
                        configuredModel?.id || selectedModelValue;
                      const canUseStoredKey = configuredModel?.apiKeyConfigured === true;
                      const canSaveModel = Boolean(
                        modelToSave && (val.trim() || canUseStoredKey),
                      );

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

                          {/* API Key 密码卡片 */}
                          <div
                            className="settings-input-password-wrapper"
                            style={{ marginTop: 6 }}
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
                                    value={selectedModelValue}
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
                                        : "输入 API Key 后点击加载模型…"}
                                    </option>
                                    {configuredModels.map((configured: any) => (
                                      <option
                                        key={configured.resourceId || configured.id}
                                        value={modelSelectionValue(configured)}
                                      >
                                        {configured.name || configured.id} · {configured.id}（已保存）
                                      </option>
                                    ))}
                                    {providerCatalog
                                      .filter((model: any) =>
                                        !configuredModels.some((item: any) => item.id === model.id))
                                      .map((model: any) => (
                                        <option key={model.id} value={model.id}>
                                          {model.name || model.id} · {model.id}
                                        </option>
                                      ))}
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
                              disabled={!canSaveModel}
                              onClick={async () => {
                                try {
                                  const catalogModel = providerCatalog.find(
                                    (item: any) => item.id === modelToSave,
                                  );
                                  await saveApiKey(provider.id, val, {
                                    modelId: modelToSave,
                                    modelName: catalogModel?.name ||
                                      configuredModel?.name || modelToSave,
                                    resourceId: configuredModel?.resourceId,
                                  });
                                  setKeysInput((prev) => ({
                                    ...prev,
                                    [provider.id]: "",
                                  }));
                                  setNewModelInputs((prev) => ({
                                    ...prev,
                                    [provider.id]: "",
                                  }));
                                  const freshProvider = useStore.getState().settings.providers
                                    ?.find((item: any) => item.id === provider.id);
                                  const freshModel = freshProvider?.models?.find(
                                    (item: any) => configuredModel?.resourceId
                                      ? item.resourceId === configuredModel.resourceId
                                      : item.id === modelToSave,
                                  );
                                  setSelectedProviderModels((prev) => ({
                                    ...prev,
                                    [provider.id]: freshModel
                                      ? modelSelectionValue(freshModel)
                                      : modelToSave,
                                  }));
                                  setTestResults((prev) => ({
                                    ...prev,
                                    [provider.id]: {
                                      ok: true,
                                      message: val.trim()
                                        ? "模型与 Key 已保存"
                                        : "模型配置已保存",
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
                              保存模型与 Key
                            </button>
                            <button
                              className="settings-btn text-xs"
                              style={{ height: 30 }}
                              disabled={isTesting || !canSaveModel}
                              onClick={async () => {
                                setTestingProvider(provider.id);
                                const res = await testConnection({
                                  provider: provider.id,
                                  apiKey: val || undefined,
                                  resourceId: configuredModel?.resourceId,
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
                                ? `✓ ${connectionSuccessMessage(testRes)}`
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
                  style={{ padding: 20, maxWidth: 480 }}
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
                        可用模型列表 (英文逗号分隔)
                      </label>
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
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 8,
                      marginTop: 20,
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
                        await saveCustomProvider(customForm);
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
                <h3 className="app-name-large">PiCoddy Cloud</h3>
                <p className="app-version-txt">云端版本 · 0.1.0</p>
              </div>
              <p className="settings-section-desc">版本由服务端统一发布，浏览器刷新后使用最新部署。</p>
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
