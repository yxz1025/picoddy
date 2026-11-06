import { useCallback, useEffect, useRef, useState } from "react";

import { api, errorMessage } from "../api/client";

export function useApiResource<T>(path: string, initialValue: T, enabled = true) {
  const initialValueRef = useRef(initialValue);
  const [data, setData] = useState<T>(initialValue);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) return initialValueRef.current;
      setLoading(true);
      setError(null);
      try {
        const next = await api.get<T>(path, signal);
        setData(next);
        return next;
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return initialValueRef.current;
        setError(errorMessage(cause));
        throw cause;
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [enabled, path],
  );

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void reload(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [enabled, reload]);

  return { data, setData, loading, error, reload };
}
