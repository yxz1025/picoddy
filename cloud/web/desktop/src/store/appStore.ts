// 设计变量（从 renderer/index.html 的 :root 迁移）
// light/dark 双主题通过 data-theme 属性切换

export const tokens = `
:root {
  --bg: #ffffff;
  /* 参考设计 light palette: a quiet gray sidebar and a white reading surface. */
  --bg-subtle: #f2f2f2;
  --bg-sidebar: #f3f3f3;
  --bg-hover: #e9e9e9;
  --bg-active: #e1e1e1;
  --border: #e5e5e5;
  --border-soft: #eeeeee;
  --border-strong: #d2d2d2;
  --text: #202124;
  --text-2: #505154;
  --text-3: #62646a;
  --text-4: var(--text-3);
  --text-disabled: #9c9da1;
  --accent: #2563eb;
  --accent-text: #2563eb;
  --focus-ring: #2563eb;
  --accent-contrast: #ffffff;
  --accent-hover: #1d4ed8;
  --accent-soft: rgba(59, 130, 246, 0.08);
  --accent-border: rgba(59, 130, 246, 0.2);
  --green: #16a34a;
  --green-soft: #f0fdf4;
  --green-border: #bbf7d0;
  --green-text: #166534;
  --amber: #d97706;
  --red: #dc2626;
  --red-soft: #fef2f2;
  --red-border: #fecaca;
  --red-text: #991b1b;
  --blue-soft: #eff6ff;
  --blue-border: #bfdbfe;
  --blue-text: #1e40af;
  --blue-accent: #3b82f6;
  --brand-gradient: var(--accent);
  --brand-shadow: var(--shadow-sm);
  /* Light-theme conversation code blocks: soft gray surface like the reference UI. */
  --code-bg: #f5f5f6;
  --code-text: #2f3033;
  --overlay: rgba(0,0,0,.28);
  --bg-dropdown: rgba(255, 255, 255, 0.85);
  --scrollbar: #d4d4d8;
  --scrollbar-hover: #a1a1aa;
  --selection: #bfdbfe;
  --shadow-sm: 0 1px 2px rgba(16,17,20,.05);
  --shadow-md: 0 4px 14px rgba(16,17,20,.06);
  --shadow-lg: 0 12px 36px rgba(16,17,20,.08);
  --r-sm: 7px; --r: 11px; --r-lg: 16px; --r-xl: 22px;
  --chrome-height: 56px;
  --font: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", "Microsoft YaHei", system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  --font-body: var(--app-font-size, 14px);
  --font-caption: calc(var(--font-body) * 0.928571);
  --font-footnote: calc(var(--font-body) * 0.857143);
  --font-section: calc(var(--font-body) * 1.142857);
  --font-title: calc(var(--font-body) * 1.285714);
  --font-dialog: calc(var(--font-body) * 1.571429);
  --font-page: calc(var(--font-body) * 1.857143);
  --font-hero: calc(var(--font-body) * 2.285714);
  --mono: ui-monospace, "SFMono-Regular", "SF Mono", "Cascadia Mono", "Cascadia Code", Consolas, "Liberation Mono", monospace;
  --cat-c: #ef4444;
  --cat-p: #3b82f6;
  --cat-a: #0284c7;
  --cat-u: #f59e0b;
}
:root[data-theme="dark"] {
  --bg: #0f0f0f;
  --bg-subtle: #242424;
  --bg-sidebar: #1f1f1f;
  --bg-hover: #2a2a2a;
  --bg-active: #333333;
  --sidebar-hover: #2f2f2f;
  --sidebar-active: #171717;
  --border: #333333;
  --border-soft: #292929;
  --border-strong: #484848;
  --text: #eeeeee;
  --text-2: #c3c3c3;
  --text-3: #a3a3a3;
  --text-4: #9e9e9e;
  --text-disabled: #666666;
  --accent: #2563eb;
  --accent-text: #8ab4ff;
  --focus-ring: #8ab4ff;
  --accent-contrast: #ffffff;
  --accent-hover: #1d4ed8;
  --accent-soft: rgba(59, 130, 246, 0.12);
  --accent-border: rgba(59, 130, 246, 0.3);
  --green: #4ed88a;
  --green-soft: rgba(22,163,74,.15);
  --green-border: rgba(78,216,138,.3);
  --green-text: #4ed88a;
  --amber: #f59e0b;
  --red: #f47374;
  --red-soft: rgba(244,115,116,.12);
  --red-border: rgba(244,115,116,.3);
  --red-text: #f47374;
  --blue-soft: rgba(59,130,246,.12);
  --blue-border: rgba(59,130,246,.3);
  --blue-text: #60a5fa;
  --blue-accent: #60a5fa;
  --brand-gradient: var(--accent);
  --brand-shadow: var(--shadow-sm);
  --code-bg: #161616;
  --code-text: #e4e4e4;
  --overlay: rgba(0,0,0,.5);
  --bg-dropdown: rgba(24, 24, 24, 0.94);
  --scrollbar: #3f4248;
  --scrollbar-hover: #52555c;
  --selection: rgba(59,130,246,.3);
  --shadow-sm: 0 1px 2px rgba(0,0,0,.3);
  --shadow-md: 0 4px 14px rgba(0,0,0,.35);
  --shadow-lg: 0 12px 36px rgba(0,0,0,.4);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #root { height: 100%; }
body {
  font-family: var(--font);
  background: var(--bg); color: var(--text);
  font-size: var(--font-body); line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 8px; border: 3px solid transparent; background-clip: padding-box; }
::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-hover); background-clip: padding-box; border: 3px solid transparent; }
::selection { background: var(--selection); }
button { font-family: inherit; cursor: pointer; }
input, textarea, select { font-family: inherit; }
input::placeholder, textarea::placeholder { color: var(--text-3); opacity: 1; }
:where(button, input, textarea, select, summary, a):focus-visible {
  outline: 2px solid var(--focus-ring); outline-offset: 3px;
}
`;

export type Theme = "light" | "dark";

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("pi-a-theme", theme); } catch {}
}

export function initTheme(): Theme {
  let saved: string | null = null;
  try { saved = localStorage.getItem("pi-a-theme"); } catch {}
  if (!saved) {
    saved = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.dataset.theme = saved;
  return saved as Theme;
}
