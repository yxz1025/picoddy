import { useEffect } from "react";
import { create } from "zustand";
import type { UpdateSnapshot } from "../../shared/updates";

interface UpdateApi {
  getState(): Promise<UpdateSnapshot>;
  check(): Promise<UpdateSnapshot>;
  download(releaseId: string): Promise<UpdateSnapshot>;
  install(releaseId: string, mode: "now" | "when-idle"): Promise<UpdateSnapshot>;
  defer(releaseId: string): Promise<UpdateSnapshot>;
  cancelDownload(operationId: string): Promise<UpdateSnapshot>;
  openReleaseNotes(releaseId: string): Promise<void>;
  openLogs(): Promise<void>;
  health(): Promise<void>;
  onState(callback: (snapshot: UpdateSnapshot) => void): () => void;
}
export function updateApi(): UpdateApi | undefined {
  return (window as unknown as { electronAPI?: { updates?: UpdateApi } }).electronAPI?.updates;
}
export const useUpdateStore = create<{ snapshot?: UpdateSnapshot; commandError?: string;
  accept(snapshot: UpdateSnapshot): void; run(command: () => Promise<unknown>): Promise<void> }>((set) => ({
  accept: (snapshot) => set((old) => old.snapshot && old.snapshot.revision > snapshot.revision ? old : { snapshot }),
  run: async (command) => {
    set({ commandError: undefined });
    try { await command(); } catch { set({ commandError: "更新操作未完成，请重试" }); }
  },
}));
export function useUpdateConnection() {
  useEffect(() => {
    const api = updateApi();
    if (!api) return;
    const unsubscribe = api.onState(useUpdateStore.getState().accept);
    void api.getState().then(useUpdateStore.getState().accept).catch(() => {});
    void api.health().catch(() => {});
    return unsubscribe;
  }, []);
}
