import { useEffect } from "react";

import {
  CLOUD_RUN_START_EVENT,
  type CloudRunStartDetail,
} from "../api/runStream";
import { useStore } from "../store/useStore";

function isRunStartDetail(value: unknown): value is CloudRunStartDetail {
  if (!value || typeof value !== "object") return false;
  const detail = value as Partial<CloudRunStartDetail>;
  return typeof detail.conversationId === "string" && detail.conversationId.length > 0 &&
    typeof detail.runId === "string" && detail.runId.length > 0;
}

/** Browser event bridge retained under the desktop hook name for App compatibility. */
export function useIPC() {
  useEffect(() => {
    const onRunStart = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isRunStartDetail(detail)) return;
      useStore.getState().startRunStream(detail.conversationId, detail.runId);
    };
    window.addEventListener(CLOUD_RUN_START_EVENT, onRunStart);
    return () => window.removeEventListener(CLOUD_RUN_START_EVENT, onRunStart);
  }, []);
}
