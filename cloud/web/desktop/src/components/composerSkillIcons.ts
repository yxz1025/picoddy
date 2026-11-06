
/** 欢迎页场景标签对应的输入框图标，与 WelcomeScreen 子 tab 一致。 */
export const COMPOSER_SCENE_ICONS: Readonly<Record<string, string>> = {
  "/document-processing": "file-text",
  "/data-analysis": "bar-chart-3",
  "/frontend-create": "globe",
  "/frontend-design": "layout",
  "/daily-dev": "file-code",
};

export function composerSceneIconId(command: string): string | null {
  return COMPOSER_SCENE_ICONS[command.trim().toLowerCase()] ?? null;
}
