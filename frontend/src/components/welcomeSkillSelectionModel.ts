import { insertSkillAtCursor } from "./composerMenuModel";

export interface WelcomeSkillSelection {
  command: string;
  label: string;
  companionCommands?: string[];
  prompt?: string;
}

export type WelcomeSkillEventDetail = WelcomeSkillSelection;

export const DAILY_DEV_COMMAND = "/daily-dev";
export const COMPOSER_CLEAR_DRAFT_EVENT = "composer:clear-draft";
export const COMPOSER_SKILL_REMOVED_EVENT = "composer:skill-removed";

export const DAILY_DEV_DEFAULT_PROMPT =
  "帮我给当前项目添加一个新功能：【功能描述】。";

export interface DailyDevScenario {
  id: string;
  label: string;
  prompt: string;
}

export const DAILY_DEV_SCENARIOS: readonly DailyDevScenario[] = [
  {
    id: "feature",
    label: "新增功能开发",
    prompt: DAILY_DEV_DEFAULT_PROMPT,
  },
  {
    id: "refactor",
    label: "代码重构优化",
    prompt: "帮我重构这段代码，提升可读性和可维护性。",
  },
  {
    id: "bugfix",
    label: "修复Bug",
    prompt: "帮我修复这个 Bug：【Bug 描述】。",
  },
  {
    id: "perf",
    label: "性能优化",
    prompt: "帮我优化这个功能的性能，当前问题是【性能问题描述】。",
  },
  {
    id: "test",
    label: "补充单元测试",
    prompt: "帮我给这个模块添加单元测试，覆盖核心逻辑。",
  },
  {
    id: "investigate",
    label: "排查报错修复",
    prompt: "帮我排查这个报错：【错误信息】，找出原因并修复。",
  },
];

export function buildDailyDevSelection(prompt?: string): WelcomeSkillSelection {
  return {
    command: DAILY_DEV_COMMAND,
    label: "日常开发",
    ...(prompt ? { prompt } : {}),
  };
}

export const WELCOME_FIXED_SKILLS: readonly WelcomeSkillSelection[] = [
  { command: "/document-processing", label: "文档处理" },
  { command: "/data-analysis", label: "数据分析" },
  { command: "/frontend-create", label: "网站开发" },
  { command: "/frontend-design", label: "UI 设计" },
  { command: DAILY_DEV_COMMAND, label: "日常开发" },
];

const WELCOME_SKILLS_BY_ENTRY = new Map<string, WelcomeSkillSelection>([
  ["日常办公\u0000文档处理", WELCOME_FIXED_SKILLS[0]],
  ["日常办公\u0000数据分析", WELCOME_FIXED_SKILLS[1]],
  ["代码开发\u0000网站开发", WELCOME_FIXED_SKILLS[2]],
  ["设计创意\u0000UI 设计", WELCOME_FIXED_SKILLS[3]],
  ["代码开发\u0000日常开发", buildDailyDevSelection()],
]);

export function getWelcomeSkillSelection(
  mainTab: string,
  subTab: string,
): WelcomeSkillSelection | undefined {
  return WELCOME_SKILLS_BY_ENTRY.get(`${mainTab}\u0000${subTab}`);
}



export function buildWelcomeSkillPrefix(selection: WelcomeSkillSelection): string {
  const skills = [
    selection.command,
    ...(selection.companionCommands ?? []),
  ].join(" ");
  const prompt = selection.prompt?.trim();
  return prompt ? `${skills} ${prompt}` : skills;
}

/**
 * 场景标签写入输入框：与 `/` 选技能相同，用零宽边界切开命令，
 * 不追加可见空格，避免退格后剩下 `/命令` 被当成斜杠查询。
 * 切换场景时只保留新标签与可选提示词，不拼接上一场景的正文。
 */
export function applyWelcomeSkillToComposer(
  text: string,
  selection: WelcomeSkillSelection,
): { text: string; caret: number } | null {
  const commands = [
    selection.command.trim(),
    ...(selection.companionCommands ?? []).map((item) => item.trim()),
  ].filter((item) => item.startsWith("/"));
  if (commands.length === 0) return null;

  const prefix = buildWelcomeSkillPrefix({
    ...selection,
    command: commands[0],
    companionCommands: commands.slice(1),
  });
  const current = text.replace(/^[\s\u200B]+/, "");
  if (current.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const prompt = selection.prompt?.trim() ?? "";

  let next = "";
  let caret = 0;
  for (const command of commands) {
    const inserted = insertSkillAtCursor(next, caret, command);
    next = inserted.text;
    caret = inserted.caret;
  }
  if (prompt) {
    next = `${next}${prompt}`;
    caret = next.length;
  }
  return { text: next, caret };
}
