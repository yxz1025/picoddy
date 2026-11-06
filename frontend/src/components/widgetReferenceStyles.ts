// Visualizer CSS from the locally installed 参考设计, 2026-10-15.
export const WIDGET_REFERENCE_CSS = `
/* 文本类 */
.t { font-family: var(--font-sans, system-ui, -apple-system, sans-serif); font-size: 14px; fill: var(--color-text-primary, currentColor); }
.ts { font-family: var(--font-sans, system-ui, -apple-system, sans-serif); font-size: 12px; fill: var(--color-text-secondary, currentColor); }
.th { font-family: var(--font-sans, system-ui, -apple-system, sans-serif); font-size: 14px; font-weight: 500; fill: var(--color-text-primary, currentColor); }

/* 容器类 */
.box { fill: var(--color-background-secondary, #f5f5f5); stroke: var(--color-border-tertiary, #e0e0e0); stroke-width: 1; rx: 6; }
.node { cursor: pointer; }
.node:hover .box { fill: var(--color-background-tertiary, #ebebeb); }

/* 线条类 */
.arr { stroke: var(--color-text-secondary, #666); stroke-width: 1.5; fill: none; marker-end: url(#arrowhead); }
.leader { stroke: var(--color-border-tertiary, #ccc); stroke-width: 0.5; stroke-dasharray: 4 2; fill: none; }

/* 色板类 — 浅色默认值，暗色通过 .dark 祖先类覆盖 */
.c-purple { --node-bg: #EEEDFE; --node-border: #7F77DD; --node-text: #26215C; --node-text-sub: #534AB7; }
.c-teal   { --node-bg: #E1F5EE; --node-border: #1D9E75; --node-text: #04342C; --node-text-sub: #0F6E56; }
.c-coral  { --node-bg: #FAECE7; --node-border: #D85A30; --node-text: #4A1B0C; --node-text-sub: #9B3318; }
.c-pink   { --node-bg: #FBEAF0; --node-border: #D4537E; --node-text: #4B1528; --node-text-sub: #9C2D56; }
.c-gray   { --node-bg: #F1EFE8; --node-border: #888780; --node-text: #2C2C2A; --node-text-sub: #5C5C5A; }
.c-blue   { --node-bg: #E6F1FB; --node-border: #378ADD; --node-text: #042C53; --node-text-sub: #1B5C99; }
.c-green  { --node-bg: #EAF3DE; --node-border: #639922; --node-text: #173404; --node-text-sub: #3A6B10; }
.c-amber  { --node-bg: #FAEEDA; --node-border: #BA7517; --node-text: #412402; --node-text-sub: #7A4A10; }
.c-red    { --node-bg: #FCEBEB; --node-border: #E24B4A; --node-text: #501313; --node-text-sub: #9B2222; }

/* 暗色模式：覆盖色板变量（深背景 + 浅文字）
 * 双路触发：.dark 类（widget:theme 消息注入）+ prefers-color-scheme 媒体查询（不依赖消息时序）。
 * 媒体查询确保首次渲染时主题已就绪；.dark 类确保宿主显式切换主题时能覆盖系统偏好。 */
.dark .c-purple { --node-bg: #26215C; --node-border: #7F77DD; --node-text: #EEEDFE; --node-text-sub: #B8B4F5; }
.dark .c-teal   { --node-bg: #04342C; --node-border: #1D9E75; --node-text: #E1F5EE; --node-text-sub: #7DDDC0; }
.dark .c-coral  { --node-bg: #4A1B0C; --node-border: #D85A30; --node-text: #FAECE7; --node-text-sub: #F0A080; }
.dark .c-pink   { --node-bg: #4B1528; --node-border: #D4537E; --node-text: #FBEAF0; --node-text-sub: #F0A0C0; }
.dark .c-gray   { --node-bg: #2C2C2A; --node-border: #888780; --node-text: #F1EFE8; --node-text-sub: #B8B6B0; }
.dark .c-blue   { --node-bg: #042C53; --node-border: #378ADD; --node-text: #E6F1FB; --node-text-sub: #90C4F0; }
.dark .c-green  { --node-bg: #173404; --node-border: #639922; --node-text: #EAF3DE; --node-text-sub: #A0D060; }
.dark .c-amber  { --node-bg: #412402; --node-border: #BA7517; --node-text: #FAEEDA; --node-text-sub: #E0A860; }
.dark .c-red    { --node-bg: #501313; --node-border: #E24B4A; --node-text: #FCEBEB; --node-text-sub: #F09090; }

@media (prefers-color-scheme: dark) {
    .c-purple { --node-bg: #26215C; --node-border: #7F77DD; --node-text: #EEEDFE; --node-text-sub: #B8B4F5; }
    .c-teal   { --node-bg: #04342C; --node-border: #1D9E75; --node-text: #E1F5EE; --node-text-sub: #7DDDC0; }
    .c-coral  { --node-bg: #4A1B0C; --node-border: #D85A30; --node-text: #FAECE7; --node-text-sub: #F0A080; }
    .c-pink   { --node-bg: #4B1528; --node-border: #D4537E; --node-text: #FBEAF0; --node-text-sub: #F0A0C0; }
    .c-gray   { --node-bg: #2C2C2A; --node-border: #888780; --node-text: #F1EFE8; --node-text-sub: #B8B6B0; }
    .c-blue   { --node-bg: #042C53; --node-border: #378ADD; --node-text: #E6F1FB; --node-text-sub: #90C4F0; }
    .c-green  { --node-bg: #173404; --node-border: #639922; --node-text: #EAF3DE; --node-text-sub: #A0D060; }
    .c-amber  { --node-bg: #412402; --node-border: #BA7517; --node-text: #FAEEDA; --node-text-sub: #E0A860; }
    .c-red    { --node-bg: #501313; --node-border: #E24B4A; --node-text: #FCEBEB; --node-text-sub: #F09090; }
}

/* 语义类（.box / .t / .th / .ts）消费色板变量 */
.c-purple .box, .c-teal .box, .c-coral .box, .c-pink .box, .c-gray .box,
.c-blue .box, .c-green .box, .c-amber .box, .c-red .box {
    fill: var(--node-bg); stroke: var(--node-border);
}
.c-purple .t, .c-teal .t, .c-coral .t, .c-pink .t, .c-gray .t,
.c-blue .t, .c-green .t, .c-amber .t, .c-red .t,
.c-purple .th, .c-teal .th, .c-coral .th, .c-pink .th, .c-gray .th,
.c-blue .th, .c-green .th, .c-amber .th, .c-red .th {
    fill: var(--node-text);
}
.c-purple .ts, .c-teal .ts, .c-coral .ts, .c-pink .ts, .c-gray .ts,
.c-blue .ts, .c-green .ts, .c-amber .ts, .c-red .ts {
    fill: var(--node-text-sub);
}

/* 兜底：模型直接输出 SVG 原生元素（无语义类）时自动应用色板变量。
 * 仅覆盖封闭形状（rect/circle/ellipse）；path 可能是箭头/线条，不统一覆盖。
 * SVG presentation attribute（fill="..."）优先级低于 CSS，无需 !important。 */
.c-purple rect, .c-teal rect, .c-coral rect, .c-pink rect, .c-gray rect,
.c-blue rect, .c-green rect, .c-amber rect, .c-red rect,
.c-purple circle, .c-teal circle, .c-coral circle, .c-pink circle, .c-gray circle,
.c-blue circle, .c-green circle, .c-amber circle, .c-red circle,
.c-purple ellipse, .c-teal ellipse, .c-coral ellipse, .c-pink ellipse, .c-gray ellipse,
.c-blue ellipse, .c-green ellipse, .c-amber ellipse, .c-red ellipse {
    fill: var(--node-bg); stroke: var(--node-border);
}
/* text 的 fill 属性同为 presentation attribute，CSS 可直接覆盖，无需 !important */
.c-purple text, .c-teal text, .c-coral text, .c-pink text, .c-gray text,
.c-blue text, .c-green text, .c-amber text, .c-red text {
    fill: var(--node-text);
}
`;
export const WIDGET_REFERENCE_THEME = `
:root {
    /* 背景色 */
    --color-background-primary: #ffffff;
    --color-background-secondary: #f5f5f5;
    --color-background-tertiary: #ebebeb;

    /* 文本色 */
    --color-text-primary: #1a1a1a;
    --color-text-secondary: #666666;
    --color-text-tertiary: #999999;

    /* 边框色 */
    --color-border-primary: rgba(0, 0, 0, 0.4);
    --color-border-secondary: rgba(0, 0, 0, 0.3);
    --color-border-tertiary: rgba(0, 0, 0, 0.15);

    /* 字体 */
    --font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --font-serif: Georgia, 'Times New Roman', serif;
    --font-mono: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;

    /* 圆角 */
    --border-radius-sm: 4px;
    --border-radius-md: 8px;
    --border-radius-lg: 12px;
    --border-radius-xl: 16px;
}

.dark {
    --color-background-primary: #1a1a1a;
    --color-background-secondary: #2a2a2a;
    --color-background-tertiary: #333333;

    --color-text-primary: #e0e0e0;
    --color-text-secondary: #a0a0a0;
    --color-text-tertiary: #707070;

    --color-border-primary: rgba(255, 255, 255, 0.4);
    --color-border-secondary: rgba(255, 255, 255, 0.3);
    --color-border-tertiary: rgba(255, 255, 255, 0.15);
}
`;
