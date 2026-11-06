/**
 * useIPC — 消费主进程推送的 ServerEvent，映射到 Zustand Store。
 * 参考 agent-1.0.24 / docs/15-IPC协议
 *
 * RAF 批处理 stream.partial / stream.thinking 高频事件。
 */

import { useEffect, useRef } from "react";
import { useStore } from "../store/useStore";

export function useIPC() {
  const pendingPartials = useRef<Record<string, string[]>>({});
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.on) return;

    const unsub = api.on((event: { type: string; payload: Record<string, unknown> }) => {
      const { type, payload } = event;
      const s = useStore.getState();

      switch (type) {
        case "stream.partial": {
          const sid = payload.sessionId as string;
          const delta = payload.delta as string;
          if (!pendingPartials.current[sid]) pendingPartials.current[sid] = [];
          pendingPartials.current[sid].push(delta);
          if (rafId.current === null) {
            rafId.current = requestAnimationFrame(() => {
              rafId.current = null;
              for (const [k, v] of Object.entries(pendingPartials.current)) {
                if (v.length > 0) {
                  const msgs = s.messages;
                  const last = msgs[msgs.length - 1];
                  if (last?.role === "assistant" && last.status === "running") {
                    s.updateLastMessage(last.id, last.content + v.join(""));
                  }
                  pendingPartials.current[k] = [];
                }
              }
            });
          }
          break;
        }

        case "session.status": {
          const sid = payload.sessionId as string;
          const status = payload.status as string;
          s.updateConversationStatus(sid, status);
          break;
        }

        case "session.list": {
          s.loadConversations();
          break;
        }

        case "permission.request": {
          s.requestUiConfirm({
            title: `工具: ${payload.toolName}`,
            message: JSON.stringify(payload.input, null, 2).slice(0, 200),
            confirmLabel: "允许",
            cancelLabel: "拒绝",
          });
          break;
        }
      }
    });

    return unsub;
  }, []);
}
