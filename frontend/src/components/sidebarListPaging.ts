/** 侧栏任务/文件夹会话：首屏 5 条，之后每次再露出 10 条。 */
export const SIDEBAR_LIST_INITIAL = 5;
export const SIDEBAR_LIST_STEP = 10;

export type SidebarListPagerState = {
  shown: number;
  remaining: number;
  showMore: boolean;
  showCollapse: boolean;
};

export function sidebarListPagerState(
  total: number,
  visible: number,
): SidebarListPagerState {
  const shown = Math.min(Math.max(visible, 0), Math.max(total, 0));
  const remaining = Math.max(total - shown, 0);
  if (total <= SIDEBAR_LIST_INITIAL) {
    return { shown, remaining, showMore: false, showCollapse: false };
  }
  return {
    shown,
    remaining,
    showMore: shown < total,
    showCollapse: shown > SIDEBAR_LIST_INITIAL,
  };
}

export function expandSidebarVisible(visible: number, total: number): number {
  return Math.min(visible + SIDEBAR_LIST_STEP, Math.max(total, 0));
}

export function collapseSidebarVisible(): number {
  return SIDEBAR_LIST_INITIAL;
}

const PINNED_CONV_KEY = "pi-a-pinned-convs";

export function readPinnedConvIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_CONV_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function writePinnedConvIds(ids: readonly string[]): void {
  try {
    localStorage.setItem(PINNED_CONV_KEY, JSON.stringify(ids));
  } catch {
    /* 私密模式或存储不可用时忽略 */
  }
}

export function togglePinnedConvId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [id, ...ids];
}

export function sortConvsByPinned<T extends { id: string }>(
  convs: readonly T[],
  pinnedIds: readonly string[],
): T[] {
  if (pinnedIds.length === 0) return [...convs];
  const order = new Map(pinnedIds.map((id, index) => [id, index]));
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const conv of convs) {
    if (order.has(conv.id)) pinned.push(conv);
    else rest.push(conv);
  }
  pinned.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return [...pinned, ...rest];
}
