// 渲染层连接器模型：把后端 connector.* DTO 映射为卡片动作与视图文本。
// 纯函数、无副作用，后端状态权威；此处只做展示派生，便于独立测试。

export type ConnectorState =
  | "not_installed"
  | "installing"
  | "installed_unauthorized"
  | "authorizing"
  | "ready"
  | "auth_expired"
  | "install_failed"
  | "version_invalid"
  | "auth_failed"
  | "runtime_broken"
  | "connector_broken";

export interface ConnectorServiceItem {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly icon: string;
  readonly toolName: string;
  readonly catalogVersion: string;
  readonly installedCatalogVersion: string;
  readonly state: ConnectorState;
  readonly cliVersion?: string;
  readonly updatedAt: string;
  readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean };
}

export type ConnectorAction = "activate" | "cancel" | "reauthorize" | "logout" | "uninstall" | "repair" | "update";
export type ConnectorPrimaryAction = "activate" | "reauthorize" | "repair";

const BUSY_STATES: ReadonlySet<ConnectorState> = new Set(["installing", "authorizing"]);

export type ConnectorCardControl =
  | { readonly kind: "install"; readonly action: "activate" }
  | { readonly kind: "busy" }
  | { readonly kind: "reauthorize"; readonly action: "reauthorize" }
  | { readonly kind: "repair"; readonly action: "repair" }
  | { readonly kind: "conversation" };

/** 参考设计 风格卡片只保留一个权威主操作，不在卡片底部展开管理动作。 */
export function cardControlFor(item: ConnectorServiceItem): ConnectorCardControl {
  switch (item.state) {
    case "installing":
    case "authorizing":
      return { kind: "busy" };
    case "installed_unauthorized":
    case "auth_failed":
    case "auth_expired":
      return { kind: "reauthorize", action: "reauthorize" };
    case "runtime_broken":
    case "connector_broken":
      return { kind: "repair", action: "repair" };
    case "ready":
      return { kind: "conversation" };
    case "not_installed":
    case "install_failed":
    case "version_invalid":
      return { kind: "install", action: "activate" };
  }
}

export const STATE_LABELS: Readonly<Record<ConnectorState, string>> = {
  not_installed: "未安装",
  installing: "正在安装连接器依赖",
  installed_unauthorized: "已安装，未授权",
  authorizing: "等待授权完成",
  ready: "已就绪",
  auth_expired: "授权已过期",
  install_failed: "安装失败",
  version_invalid: "版本无效",
  auth_failed: "授权失败",
  runtime_broken: "运行环境异常",
  connector_broken: "连接器异常",
};

export interface ConnectorView {
  readonly label: string;
  readonly busy: boolean;
  readonly cancellable: boolean;
  readonly primaryAction?: ConnectorAction;
}

export function viewFor(item: ConnectorServiceItem): ConnectorView {
  const busy = BUSY_STATES.has(item.state);
  return {
    label: STATE_LABELS[item.state],
    busy,
    cancellable: busy,
    primaryAction: item.state === "auth_expired" ? "reauthorize" : undefined,
  };
}

// 加载失败文案：目录或运行时无效属于环境问题，给出可理解的提示与升级建议，而不是透传内部错误。
export function connectorLoadErrorLabel(code: string | null, message: string | null): string | null {
  if (code === "CONNECTOR_RUNTIME_UNAVAILABLE" || code === "CONNECTOR_CATALOG_INVALID") {
    return "运行环境异常：连接器运行环境不可用，请重启或更新应用后再试。";
  }
  return message;
}

// 测试助手：构造一个完整可用的 DTO 条目。
export function connector(id: string, state: ConnectorState, overrides: Partial<ConnectorServiceItem> = {}): ConnectorServiceItem {
  return {
    id,
    displayName: id,
    description: id,
    icon: "/logos/x.png",
    toolName: `delegate_to_${id}`,
    catalogVersion: "1.0.0",
    installedCatalogVersion: state === "not_installed" ? "" : "1.0.0",
    state,
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}
