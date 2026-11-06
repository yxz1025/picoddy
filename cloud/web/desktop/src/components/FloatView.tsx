// frontend/src/components/FloatView.tsx — 速唤浮窗组件
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Send, Sparkles, X, Zap } from "lucide-react";
import { assistantEventText } from "../store/eventModel";
import "./FloatView.css";

export default function FloatView() {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"ask" | "craft">("ask");
  const [context, setContext] = useState<
    { app: string; selection: string } | null
  >(null);
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // 获取上下文 (前台 App + 选中文本)
  const fetchContext = async () => {
    try {
      const res = await fetch("/api/system/context");
      const data = await res.json();
      if (data && (data.app || data.selection)) {
        setContext(data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchContext();
    inputRef.current?.focus();

    // 监听 ESC 关闭浮窗
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeFloat();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, []);

  const closeFloat = () => {
    // 隐藏窗口
    fetch("/api/float/close", { method: "POST" }).catch(() => {});
  };

  const handleSend = async () => {
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setResponse("");

    try {
      // 1. 创建临时速唤会话
      const convRes = await fetch("/api/conv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `[速唤] ${prompt.slice(0, 20)}`,
          category: "assistant",
        }),
      });
      const convData = await convRes.json();
      const sessionId = convData.id;
      setCurrentSessionId(sessionId);

      // 如果有选中文本，合成入 prompt
      let fullPrompt = prompt;
      if (context?.selection) {
        fullPrompt =
          `[选中内容来自应用 "${context.app}"]:\n"""\n${context.selection}\n"""\n\n我的问题/指令：${prompt}`;
      }

      // 2. 先建立 SSE，避免短任务在监听器就绪前已经开始输出。
      const es = new EventSource(`/api/events/${sessionId}/stream`);
      eventSourceRef.current?.close();
      eventSourceRef.current = es;
      let answerText = "";
      let pendingText = "";
      let lastRelaySequence = -1;
      let renderTimer: number | null = null;
      let promptStarted = false;
      let settleStreamReady = (_connected: boolean) => {};
      const streamReady = new Promise<boolean>((resolve) => {
        let settled = false;
        const timeout = window.setTimeout(() => settle(false), 3000);
        const settle = (connected: boolean) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          resolve(connected);
        };
        settleStreamReady = settle;
        es.onopen = () => settle(true);
      });
      const flushText = () => {
        if (!pendingText) return;
        answerText += pendingText;
        pendingText = "";
        setResponse(answerText);
      };
      const scheduleFlush = () => {
        if (renderTimer !== null) return;
        renderTimer = window.setTimeout(() => {
          renderTimer = null;
          flushText();
        }, 50);
      };

      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.type === "stream_resync_required") {
            lastRelaySequence = Number(ev.relaySequence);
            if (typeof ev.text === "string" && ev.text) {
              answerText = ev.text;
              pendingText = "";
              setResponse(answerText);
            } else {
              void fetch(`/api/msgs/${sessionId}`).then((response) =>
                response.json()
              ).then((result) => {
                const messages = Array.isArray(result)
                  ? result
                  : result?.messages ?? [];
                const final = [...messages].reverse().find(
                  (message: any) => message?.role === "assistant",
                );
                if (final?.content) {
                  answerText = String(final.content);
                  pendingText = "";
                  setResponse(answerText);
                }
              }).catch(() => {});
            }
            return;
          }
          if (ev.type === "stream_text") {
            if (ev.channel === "thinking") return;
            const relaySequence = Number(ev.relaySequence);
            if (!Number.isSafeInteger(relaySequence)) return;
            if (
              (ev.mode === "delta" && relaySequence <= lastRelaySequence) ||
              (ev.mode === "snapshot" && relaySequence < lastRelaySequence)
            ) return;
            lastRelaySequence = relaySequence;
            if (ev.mode === "snapshot") {
              answerText = String(ev.text ?? "");
              pendingText = "";
              setResponse(answerText);
            } else {
              pendingText += String(ev.text ?? "");
              scheduleFlush();
            }
          }
          if (ev.type === "message_end" && ev.message?.role === "assistant") {
            if (renderTimer !== null) window.clearTimeout(renderTimer);
            renderTimer = null;
            pendingText = "";
            answerText = assistantEventText(ev.message);
            setResponse(answerText);
          }
          if (ev.type === "agent_end") {
            if (renderTimer !== null) window.clearTimeout(renderTimer);
            renderTimer = null;
            flushText();
            es.close();
            if (eventSourceRef.current === es) eventSourceRef.current = null;
            setLoading(false);
          }
        } catch {}
      };

      es.onerror = () => {
        if (!promptStarted) {
          settleStreamReady(false);
          if (renderTimer !== null) window.clearTimeout(renderTimer);
          es.close();
          if (eventSourceRef.current === es) eventSourceRef.current = null;
          setLoading(false);
        }
      };

      if (!await streamReady || es.readyState !== EventSource.OPEN) {
        throw new Error("流式连接建立失败");
      }

      // 3. 监听器就绪后发起 prompt。
      promptStarted = true;
      await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          text: fullPrompt,
          mode,
          permission: mode === "craft" ? "full" : "readonly",
        }),
      });
    } catch (err) {
      setResponse(`出错了: ${(err as Error).message}`);
      setLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!currentSessionId) return;
    try {
      await fetch("/api/float/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: currentSessionId }),
      });
      closeFloat();
    } catch {}
  };

  return (
    <div className="float-container">
      {/* 头部极简输入栏 */}
      <div className="float-header">
        <div className="float-brand">
          <img
            className="float-brand-image"
            src="/assistant-avatar.png"
            alt=""
          />
        </div>

        {context?.app && (
          <span
            className="float-chip"
            title={context.selection ? `选中: ${context.selection}` : undefined}
          >
            来自 {context.app}
          </span>
        )}

        <div className="float-input-row">
          <input
            ref={inputRef}
            className="float-input"
            placeholder={context?.selection
              ? `针对 "${context.app}" 选中内容提问…`
              : "给 PiCoddy 提问，按 Esc 退出…"}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
        </div>

        <div className="float-actions">
          <button
            className={`float-btn ${mode === "craft" ? "active" : ""}`}
            title={mode === "ask"
              ? "当前: Ask (问答模式)"
              : "当前: Craft (工具模式)"}
            onClick={() => setMode(mode === "ask" ? "craft" : "ask")}
          >
            {mode === "ask" ? <Zap size={14} /> : <Sparkles size={14} />}
          </button>
          <button
            className="float-send-btn"
            disabled={!prompt.trim() || loading}
            onClick={handleSend}
          >
            <Send size={13} />
          </button>
          <button className="float-btn" onClick={closeFloat} title="关闭 (Esc)">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 结果显示与转存栏 */}
      {(response || loading) && (
        <>
          <div className="float-result-body">
            {response
              ? <div style={{ whiteSpace: "pre-wrap" }}>{response}</div>
              : (
                <div
                  style={{
                    color: "var(--text-3)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span className="status-shimmer">PiCoddy 正在思考中...</span>
                </div>
              )}
          </div>

          <div className="float-result-footer">
            <span>模式: {mode.toUpperCase()}</span>
            {currentSessionId && response && (
              <button className="float-transfer-btn" onClick={handleTransfer}>
                <ExternalLink size={12} /> 转存为主会话
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
