import { useState, useEffect } from "react";
import { useStore } from "../store/useStore";
import { HelpCircle, Check, Square, Circle, CornerDownRight } from "lucide-react";
import "./AskUserQuestionDialog.css";

/**
 * 交互式提问弹窗（AskUserQuestion）。
 * 对标 参考设计 的 AskUserQuestion UI：问题卡片 + 选项 chips（单选/多选）+ 自由输入。
 * 图标一律用 lucide-react 线性图标，不使用 emoji。
 */
export default function AskUserQuestionDialog() {
  const { pendingAsk, respondAsk } = useStore();
  const [selected, setSelected] = useState<(string | string[] | null)[]>([]);
  const [freeText, setFreeText] = useState<string[]>([]);

  const questions = pendingAsk?.questions ?? [];

  // 新提问到来时重置选择
  useEffect(() => {
    if (pendingAsk) {
      setSelected(pendingAsk.questions.map(() => null));
      setFreeText(pendingAsk.questions.map(() => ""));
    }
  }, [pendingAsk?.requestId]);

  if (!pendingAsk) return null;

  const toggleSelect = (qi: number, label: string, multi: boolean) => {
    setSelected((prev) => {
      const next = [...prev];
      if (multi) {
        const cur = Array.isArray(next[qi]) ? [...(next[qi] as string[])] : [];
        const i = cur.indexOf(label);
        if (i >= 0) cur.splice(i, 1);
        else cur.push(label);
        next[qi] = cur;
      } else {
        next[qi] = label;
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    const answers = questions.map((q, i) => {
      const ft = freeText[i]?.trim();
      if (ft) return ft;
      return selected[i] ?? (q.multiSelect ? [] : null);
    });
    await respondAsk(answers);
  };

  return (
    <div className="ask-overlay">
      <div className="ask-card">
        <div className="ask-header">
          <HelpCircle size={16} className="ask-icon" />
          <span className="ask-title">需要你的选择</span>
        </div>

        <div className="ask-body">
          {questions.map((q, qi) => (
            <div className="ask-question" key={qi}>
              <div className="ask-q-head">
                {q.header && <span className="ask-chip">{q.header}</span>}
                <span className="ask-q-text">{q.question}</span>
              </div>

              <div className="ask-options">
                {q.options.map((opt) => {
                  const isSel = q.multiSelect
                    ? Array.isArray(selected[qi]) && (selected[qi] as string[]).includes(opt.label)
                    : selected[qi] === opt.label;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      className={"ask-option" + (isSel ? " ask-option--sel" : "")}
                      onClick={() => toggleSelect(qi, opt.label, !!q.multiSelect)}
                    >
                      <span className="ask-option-mark">
                        {isSel ? (
                          <Check size={13} />
                        ) : q.multiSelect ? (
                          <Square size={13} />
                        ) : (
                          <Circle size={13} />
                        )}
                      </span>
                      <span className="ask-option-label">{opt.label}</span>
                      {opt.description && (
                        <span className="ask-option-desc">{opt.description}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="ask-free">
                <CornerDownRight size={13} className="ask-free-icon" />
                <input
                  className="ask-free-input"
                  placeholder="或输入其他内容…"
                  value={freeText[qi] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFreeText((prev) => {
                      const n = [...prev];
                      n[qi] = v;
                      return n;
                    });
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="ask-actions">
          <button type="button" className="ask-submit" onClick={handleSubmit}>
            <Check size={13} /> 提交
          </button>
        </div>
      </div>
    </div>
  );
}
