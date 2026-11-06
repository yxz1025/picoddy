import type { RunMode } from "../store/useStore";

export interface PromptScenario {
  id: string;
  title: string;
  desc: string;
  prompt: string;
  skillCmd?: string;
  mode?: RunMode;
  icon: string;
}

export const CODE_DAILY_SCENARIOS: PromptScenario[] = [
  {
    id: "dev-fix",
    title: "代码检查与 Bug 修复",
    desc: "分析工作区代码中的类型错误与规范问题并自动修补",
    prompt: "请扫描当前工作区，帮我分析代码中的潜在错误或规范问题并修补",
    mode: "craft",
    icon: "⚡",
  },
  {
    id: "dev-web",
    title: "现代 Web 组件构建",
    desc: "基于 React / CSS 最佳实践构建现代 UI 组件与响应式界面",
    prompt: "请按照现代 Web 最佳实践为我设计前端界面与组件",
    skillCmd: "/frontend-create",
    mode: "craft",
    icon: "🚀",
  },
];
