export interface PluginCatalogItem {
  /** npm 包名（安装参数） */
  pkg: string;
  /** 中文显示名 */
  name: string;
  /** 中文描述 */
  description: string;
  /** 只读工具名（包未声明 "pi.readOnlyTools" 时的兜底白名单） */
  readOnlyTools?: string[];
}

/** 内置精选插件清单（数据源：pi.dev/packages 生态目录，按实用性精选）。 */
export const PLUGIN_CATALOG: PluginCatalogItem[] = [
  {
    pkg: "pi-local-rag",
    name: "文档处理",
    description: "本地文档索引、关键词与语义检索、增量刷新和上下文注入",
    readOnlyTools: ["rag_query", "rag_status"],
  },
  {
    pkg: "pi-web-access",
    name: "联网搜索",
    description: "Web 搜索、URL 抓取、GitHub 克隆、PDF 提取与视频分析，支持多家搜索提供商",
    readOnlyTools: [
      "web_search",
      "fetch_content",
      "get_search_content",
      "source_check",
    ],
  },
  {
    pkg: "pi-mcp-adapter",
    name: "MCP 适配器",
    description: "把任意 MCP server 压缩为单一代理工具，懒加载省上下文",
  },
  {
    pkg: "pi-subagents",
    name: "子代理",
    description: "单代理委托与脚本化多代理工作流",
  },
  {
    pkg: "pi-lens",
    name: "代码反馈",
    description: "实时代码反馈：LSP、linter、formatter、类型检查",
  },
  {
    pkg: "pi-background-tasks",
    name: "后台任务",
    description: "持久后台 shell 任务与只读委托代理",
  },
  {
    pkg: "pi-memory",
    name: "记忆扩展",
    description: "qmd 驱动的语义搜索，覆盖每日日志、长期记忆与便签",
  },
  {
    pkg: "pi-plan-mode",
    name: "计划模式",
    description: "Codex 风格只读 /plan 协作模式",
  },
  {
    pkg: "pi-agent-browser-native",
    name: "浏览器自动化",
    description: "把 agent-browser 暴露为原生工具",
  },
  {
    pkg: "pi-fabric",
    name: "工具运行时",
    description: "可编程工具与代理运行时",
  },
  {
    pkg: "@juicesharp/rpiv-todo",
    name: "待办清单",
    description: "模型待办清单，实时浮层显示，跨对话存活",
  },
];
