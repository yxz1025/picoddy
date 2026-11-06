import {
  Check,
  ChevronDown,
  CircleAlert,
  HatGlasses,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ApiError } from "../api/client";
import type { Conversation } from "../store/useStore";
import { useSkillStore } from "../store/useSkillStore";
import type { ExpertSummary } from "../types/experts";

interface ConversationExpertControlProps {
  conversation: Conversation;
  busy: boolean;
}

const BLOCKING_STATUSES = new Set(["running", "pending", "initializing"]);

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code
      ? `${error.message}（${error.code}）`
      : error.message;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "专家切换失败，请重试";
}

function expertInitial(expert: ExpertSummary | undefined, fallback?: string) {
  return (expert?.name || fallback || "专").trim().charAt(0) || "专";
}

function optionIsDisabled(
  index: number,
  experts: ExpertSummary[],
  changesDisabled: boolean,
  hasActiveExpert: boolean,
): boolean {
  if (changesDisabled) return true;
  if (index < experts.length) return !experts[index].available;
  return !hasActiveExpert;
}

function ExpertAvatar({
  expert,
  fallback,
  size = "sm",
}: {
  expert?: ExpertSummary;
  fallback?: string;
  size?: "sm" | "md";
}) {
  return (
    <span className={`conversation-expert-avatar ${size}`} aria-hidden="true">
      {expert?.icon
        ? <img src={expert.icon} alt="" />
        : expertInitial(expert, fallback)}
    </span>
  );
}

export default function ConversationExpertControl({
  conversation,
  busy,
}: ConversationExpertControlProps) {
  const experts = useSkillStore((state) => state.experts);
  const expertsError = useSkillStore((state) => state.expertsError);
  const loadExperts = useSkillStore((state) => state.loadExperts);
  const assignConversationExpert = useSkillStore(
    (state) => state.assignConversationExpert,
  );
  const clearConversationExpert = useSkillStore(
    (state) => state.clearConversationExpert,
  );
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expertsLoading, setExpertsLoading] = useState(false);
  const [expertsLoadError, setExpertsLoadError] = useState<string | null>(null);
  const [activeOptionIndex, setActiveOptionIndex] = useState<number | null>(
    null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `conversation-expert-menu-${conversation.id.replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  )}`;

  useEffect(() => {
    if (experts.length > 0) {
      setExpertsLoading(false);
      setExpertsLoadError(null);
      return;
    }
    if (expertsError) {
      setExpertsLoading(false);
      setExpertsLoadError(expertsError);
      return;
    }
    let mounted = true;
    setExpertsLoading(true);
    setExpertsLoadError(null);
    void loadExperts()
      .catch((cause) => {
        if (mounted) setExpertsLoadError(getErrorMessage(cause));
      })
      .finally(() => {
        if (mounted) setExpertsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [experts.length, expertsError, loadExperts]);

  useEffect(() => {
    setOpen(false);
    setError(null);
    setActiveOptionIndex(null);
  }, [conversation.id]);

  const activeExpert = conversation.expertId
    ? experts.find((expert) => expert.id === conversation.expertId) ||
      conversation.expert ||
      undefined
    : undefined;
  const isBlocked = busy || BLOCKING_STATUSES.has(
    String(conversation.status || "").toLowerCase(),
  );
  const isPending = pendingId !== null;
  const changesDisabled = isBlocked || isPending;

  const optionCount = experts.length + (conversation.expertId ? 1 : 0);
  const focusableOptionIndices = Array.from({ length: optionCount }, (_, i) => i)
    .filter((index) => !optionIsDisabled(
      index,
      experts,
      changesDisabled,
      Boolean(conversation.expertId),
    ));
  const selectedOptionIndex = conversation.expertId
    ? experts.findIndex((expert) => expert.id === conversation.expertId)
    : -1;
  const initialOptionIndex = focusableOptionIndices.includes(selectedOptionIndex)
    ? selectedOptionIndex
    : focusableOptionIndices[0] ?? null;

  const closeMenu = useCallback((focusTrigger = false) => {
    setOpen(false);
    setActiveOptionIndex(null);
    if (focusTrigger) {
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMenu, open]);

  useEffect(() => {
    if (!open) return;
    setActiveOptionIndex((current) =>
      current !== null && !optionIsDisabled(
        current,
        experts,
        changesDisabled,
        Boolean(conversation.expertId),
      )
        ? current
        : initialOptionIndex,
    );
    menuRef.current?.focus();
  }, [changesDisabled, conversation.expertId, experts, initialOptionIndex, open]);

  const handleAssign = async (expert: ExpertSummary) => {
    if (changesDisabled || !expert.available) return;
    if (expert.id === conversation.expertId) {
      closeMenu();
      return;
    }
    setError(null);
    setPendingId(expert.id);
    try {
      await assignConversationExpert(conversation.id, expert.id);
      closeMenu(true);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setPendingId(null);
    }
  };

  const handleClear = async () => {
    if (changesDisabled || !conversation.expertId) return;
    setError(null);
    setPendingId("clear");
    try {
      await clearConversationExpert(conversation.id);
      closeMenu(true);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setPendingId(null);
    }
  };

  const openMenu = () => {
    if (changesDisabled) return;
    setError(null);
    setActiveOptionIndex(initialOptionIndex);
    setOpen(true);
  };

  const handleSelectIndex = (index: number) => {
    if (optionIsDisabled(
      index,
      experts,
      changesDisabled,
      Boolean(conversation.expertId),
    )) return;
    if (index < experts.length) {
      void handleAssign(experts[index]);
    } else {
      void handleClear();
    }
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      closeMenu();
      return;
    }
    if (focusableOptionIndices.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const currentPosition = Math.max(
        0,
        focusableOptionIndices.indexOf(activeOptionIndex ?? initialOptionIndex ?? 0),
      );
      const offset = event.key === "ArrowDown" ? 1 : -1;
      const nextPosition = (currentPosition + offset + focusableOptionIndices.length) %
        focusableOptionIndices.length;
      setActiveOptionIndex(focusableOptionIndices[nextPosition]);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveOptionIndex(
        event.key === "Home"
          ? focusableOptionIndices[0]
          : focusableOptionIndices[focusableOptionIndices.length - 1],
      );
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (activeOptionIndex !== null) handleSelectIndex(activeOptionIndex);
    }
  };

  const handleTriggerKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) closeMenu();
      else openMenu();
    }
  };

  return (
    <div className="conversation-expert-control" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`conversation-expert-trigger ${activeExpert ? "active" : ""}`}
        aria-haspopup="listbox"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-label={activeExpert
          ? `当前专家：${activeExpert.name}`
          : "选择会话专家"}
        disabled={changesDisabled}
        onClick={() => {
          if (open) closeMenu();
          else openMenu();
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        {/* activeExpert
          ? <ExpertAvatar expert={activeExpert} size="sm" />
          : */ <HatGlasses size={14} aria-hidden="true" />}
        <span className="conversation-expert-trigger-copy">
          <span className="conversation-expert-name">
            {activeExpert?.name || "选择专家"}
          </span>
          {/* {activeExpert && (
            <span className="conversation-expert-status">已激活</span>
          )} */}
        </span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      {error && (
        <div className="conversation-expert-error" role="alert">
          <CircleAlert size={13} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {open && (
        <div
          className="conversation-expert-menu"
          ref={menuRef}
          role="listbox"
          tabIndex={-1}
          aria-label="会话专家"
          aria-busy={expertsLoading}
          aria-activedescendant={activeOptionIndex !== null
            ? `${menuId}-option-${activeOptionIndex}`
            : undefined}
          id={menuId}
          onKeyDown={handleMenuKeyDown}
        >
          {expertsLoading && (
            <div className="conversation-expert-menu-status" role="status" aria-live="polite">
              正在加载专家…
            </div>
          )}
          {!expertsLoading && expertsLoadError && (
            <div className="conversation-expert-menu-status error" role="alert">
              {expertsLoadError}
            </div>
          )}
          {!expertsLoading && !expertsLoadError && experts.length === 0 && (
            <div className="conversation-expert-menu-status" role="status">
              暂无可用专家
            </div>
          )}
          {experts.map((expert, index) => {
            const selected = expert.id === conversation.expertId;
            const disabled = optionIsDisabled(
              index,
              experts,
              changesDisabled,
              Boolean(conversation.expertId),
            );
            return (
              <button
                type="button"
                key={expert.id}
                id={`${menuId}-option-${index}`}
                className="conversation-expert-option"
                role="option"
                aria-selected={selected}
                aria-disabled={disabled}
                data-active={activeOptionIndex === index ? "true" : undefined}
                tabIndex={-1}
                disabled={disabled}
                onMouseEnter={() => !disabled && setActiveOptionIndex(index)}
                onClick={() => handleSelectIndex(index)}
              >
                <ExpertAvatar expert={expert} size="md" />
                <span className="conversation-expert-option-copy">
                  <span className="conversation-expert-option-name">
                    {expert.name}
                  </span>
                  <span className="conversation-expert-option-meta">
                    {expert.available ? expert.description : "当前不可用"}
                  </span>
                </span>
                <span className="conversation-expert-option-check">
                  {selected && <Check size={14} aria-hidden="true" />}
                </span>
              </button>
            );
          })}
          {conversation.expertId && (
            <button
              type="button"
              className="conversation-expert-option danger"
              role="option"
              id={`${menuId}-option-${experts.length}`}
              aria-selected={false}
              aria-disabled={changesDisabled}
              data-active={activeOptionIndex === experts.length ? "true" : undefined}
              tabIndex={-1}
              disabled={changesDisabled}
              onMouseEnter={() => !changesDisabled && setActiveOptionIndex(experts.length)}
              onClick={() => handleSelectIndex(experts.length)}
            >
              <span className="conversation-expert-avatar md" aria-hidden="true">
                ×
              </span>
              <span className="conversation-expert-option-copy">
                <span className="conversation-expert-option-name">停用专家</span>
                <span className="conversation-expert-option-meta">恢复默认助手</span>
              </span>
              <span className="conversation-expert-option-check" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
