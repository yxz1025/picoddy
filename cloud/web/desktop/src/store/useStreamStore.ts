import { create } from "zustand";
import type { Message } from "./useStore";

interface StreamState {
  activeStream: Message | null;
}

export const useStreamStore = create<StreamState>(() => ({
  activeStream: null,
}));

export function clearActiveStream(): void {
  useStreamStore.setState({ activeStream: null });
}
