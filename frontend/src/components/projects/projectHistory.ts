import { create } from 'zustand';
import type { DemoProject, DemoRun } from './projectDemo';
export type RecentRequirement = { id: string; project: Omit<DemoProject, 'runs'>; run: DemoRun; stage: number; panel?: string | null; visitedAt: number; pinned?: boolean; syncedAt?: number };
const key = (account: string) => `project-recent-v1:${encodeURIComponent(account)}`;
export const useProjectHistory = create<{ account: string; items: RecentRequirement[]; selection: { account: string; item: RecentRequirement; nonce: number } | null; storageError: boolean; activeRequirementId: string | null; overviewRequest: number }>(() => ({ account: '', items: [], selection: null, storageError: false, activeRequirementId: null, overviewRequest: 0 }));
export function loadHistory(account: string) {
  if (useProjectHistory.getState().account === account) return;
  let items: RecentRequirement[] = [];
  try { const raw = JSON.parse(localStorage.getItem(key(account)) || '[]'); if (Array.isArray(raw)) items = raw.filter(r => r?.id && r.project?.id && r.run?.tapdId && r.run?.tapdWorkspaceId && Number.isInteger(r.stage) && r.stage >= 0 && r.stage < 10 && Array.isArray(r.run.outputs) && Array.isArray(r.run.events)); } catch { /* Invalid history is not used for navigation. */ }
  useProjectHistory.setState({ account, items, selection: null, storageError: false, activeRequirementId: null, overviewRequest: 0 });
}
function save(account: string, items: RecentRequirement[]) {
  if (!account || useProjectHistory.getState().account !== account) return;
  items.sort((a,b) => Number(!!b.pinned)-Number(!!a.pinned) || b.visitedAt-a.visitedAt);
  let storageError = false;
  try { localStorage.setItem(key(account), JSON.stringify(items)); } catch { storageError = true; }
  useProjectHistory.setState({ items, storageError });
}
export function rememberRequirement(account: string, item: RecentRequirement) {
  if (useProjectHistory.getState().account !== account) return;
  const items = useProjectHistory.getState().items;
  const previous = items.find(r => r.id === item.id);
  save(account, [{ ...previous, ...item, pinned: previous?.pinned }, ...items.filter(r => r.id !== item.id)]);
}
export function updateRecent(account: string, id: string, patch: Partial<RecentRequirement> | null) {
  const state = useProjectHistory.getState(); if (state.account !== account) return;
  if (!patch && state.selection?.item.id === id) useProjectHistory.setState({ selection: null });
  save(account, patch ? state.items.map(r => r.id === id ? { ...r, ...patch } : r) : state.items.filter(r => r.id !== id));
}
export function setActiveRequirement(account: string, id: string | null) {
  if (useProjectHistory.getState().account === account) useProjectHistory.setState({ activeRequirementId: id });
}
export function openProjectOverview(account: string) {
  loadHistory(account);
  useProjectHistory.setState(state => ({ selection: null, activeRequirementId: null, overviewRequest: state.overviewRequest + 1 }));
}
export function openRecent(account: string, item: RecentRequirement) {
  loadHistory(account);
  useProjectHistory.setState({ selection: { account, item, nonce: Date.now() } });
}
