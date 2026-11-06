import {
  Badge,
  Check,
  ChevronRight,
  Feather,
  FileText,
  Hammer,
  Link2,
  Paperclip,
  Plus,
  Settings2,
} from "lucide-react";
import {
  type KeyboardEvent,
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RunMode } from "../store/useStore";
import {
  ATTACHMENT_INPUT_ACCEPT,
  skillIconHue,
  skillInitial,
} from "./composerMenuModel";
import {
  DOCUMENT_PROCESSING_LABEL,
  isDocumentProcessingCapability,
} from "./documentProcessingModel";
import { isExpertSkillSelectionAtLimit } from "./expertSkillSelectionModel";
import {
  type Expert,
  type McpConfig,
  type McpConnectionInfo,
  type SkillMeta,
  useSkillStore,
} from "../store/useSkillStore";
import "./ComposerPlusMenu.css";
import { connectorLogo } from "./connectorBadgeModel";

export interface ComposerPlusMenuProps {
  mode: RunMode;
  experts: Expert[];
  skills: SkillMeta[];
  mcpConfig: McpConfig | null;
  connected: McpConnectionInfo[];
  enterpriseConnectorError?: string | null;
  loading: boolean;
  modeLocked?: boolean;
  allowSkillSelection?: boolean;
  selectedSkillNames?: readonly string[];
  selectedConnectorNames?: readonly string[];
  skillSelectionLocked?: boolean;
  onFilesSelected(files: File[]): void;
  onDocumentProcessingSelected(): void;
  onModeSelected(mode: RunMode): void;
  onExpertSelected(expert: Expert): void | Promise<void>;
  onSkillSelected(skill: SkillMeta): void;
  onConnectorSelected(connectorName: string): void | Promise<void>;
  onOpenConnectorManager(): void;
}

type SubmenuName = "mode" | "expert" | "skill" | "connector";
type SubmenuPosition = {
  top: number;
  left: number;
  maxHeight: number;
};

function isExpertAvatarUrl(icon: string | undefined): boolean {
  const value = icon?.trim() ?? "";
  return /^https?:\/\//i.test(value) || /^data:image\//i.test(value);
}

function ExpertAvatar({ icon, name }: { icon?: string; name: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = isExpertAvatarUrl(icon) && !imageFailed;

  return (
    <span className="composer-plus__avatar" aria-hidden="true">
      {showImage
        ? <img src={icon} alt="" onError={() => setImageFailed(true)} />
        : (icon && !isExpertAvatarUrl(icon) ? icon : name.slice(0, 1) || "✦")}
    </span>
  );
}

const ROOT_ITEMS: Array<{
  id: "file" | "document" | SubmenuName;
  label: string;
  icon: typeof Paperclip;
}> = [
  { id: "file", label: "添加文件", icon: Paperclip },
  { id: "document", label: DOCUMENT_PROCESSING_LABEL, icon: FileText },
  { id: "mode", label: "模式", icon: Feather },
  { id: "expert", label: "专家", icon: Badge },
  { id: "skill", label: "技能", icon: Hammer },
  { id: "connector", label: "连接器", icon: Link2 },
];

const CREATOR_ROOT_ITEM_IDS: Array<
  "file" | "mode" | "expert" | "skill" | "connector"
> = [
  "file",
  "skill",
  "expert",
  "connector",
];

const MODES: Array<{ mode: RunMode; name: string; description: string }> = [
  { mode: "ask", name: "Ask", description: "只回答问题，不执行修改" },
  { mode: "plan", name: "Plan", description: "先梳理方案与执行步骤" },
  { mode: "craft", name: "Craft", description: "直接处理任务并交付结果" },
];

function focusMenuItem(menu: HTMLElement | null, index: number) {
  const items = menu?.querySelectorAll<HTMLElement>(
    ':scope > [role="menuitem"]:not([aria-disabled="true"]):not(:disabled), :scope > [role="menuitemcheckbox"]:not([aria-disabled="true"]):not(:disabled)',
  );
  if (!items?.length) return;
  items[(index + items.length) % items.length]?.focus();
}

function getTabbableElements() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      (element.offsetWidth > 0 || element.offsetHeight > 0),
  );
}

export default function ComposerPlusMenu({
  mode,
  experts,
  skills,
  mcpConfig,
  connected,
  enterpriseConnectorError,
  modeLocked = false,
  allowSkillSelection = true,
  selectedSkillNames = [],
  selectedConnectorNames = [],
  skillSelectionLocked = false,
  onFilesSelected,
  onDocumentProcessingSelected,
  onModeSelected,
  onExpertSelected,
  onSkillSelected,
  onConnectorSelected,
  onOpenConnectorManager,
}: ComposerPlusMenuProps) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<SubmenuName | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState<
    SubmenuPosition | null
  >(null);
  const [menuLoading, setMenuLoading] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const loadAttempted = useRef(false);
  const loadInFlight = useRef(false);
  const mountedRef = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const visibleRootItems = ROOT_ITEMS.filter((item) =>
    (!modeLocked || item.id !== "mode") &&
    (allowSkillSelection || item.id !== "skill")
  );
  const rootItems = modeLocked
    ? CREATOR_ROOT_ITEM_IDS.flatMap((id) =>
      visibleRootItems.filter((item) => item.id === id)
    )
    : visibleRootItems;
  const selectedSkillKeys = new Set(
    selectedSkillNames.map((name) => name.trim().toLowerCase()),
  );
  const skillSelectionAtLimit = isExpertSkillSelectionAtLimit(
    selectedSkillNames,
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (
      (modeLocked && submenu === "mode") ||
      (!allowSkillSelection && submenu === "skill")
    ) {
      setSubmenu(null);
      setSubmenuPosition(null);
    }
  }, [allowSkillSelection, modeLocked, submenu]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    setSubmenu(null);
    setSubmenuPosition(null);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const updateSubmenuPosition = useCallback(() => {
    const menu = menuRef.current;
    const submenuElement = submenuRef.current;
    if (!menu || !submenuElement) return;

    const margin = 8;
    const overlap = 4;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxHeight = Math.max(120, Math.min(420, viewportHeight - margin * 2));
    const menuRect = menu.getBoundingClientRect();
    const submenuRect = submenuElement.getBoundingClientRect();
    const trigger = submenu
      ? menu.querySelector<HTMLElement>(`[data-menu-id="${submenu}"]`)
      : null;
    const triggerRect = trigger?.getBoundingClientRect();
    const width = Math.min(submenuRect.width, viewportWidth - margin * 2);
    const height = Math.min(submenuRect.height, maxHeight);

    let viewportLeft = menuRect.right - overlap;
    if (viewportLeft + width > viewportWidth - margin) {
      viewportLeft = menuRect.left - width + overlap;
    }
    viewportLeft = Math.max(
      margin,
      Math.min(viewportLeft, viewportWidth - width - margin),
    );

    let viewportTop = triggerRect?.top ?? menuRect.top;
    if (viewportTop + height > viewportHeight - margin) {
      viewportTop = viewportHeight - height - margin;
    }
    viewportTop = Math.max(margin, viewportTop);

    // The submenu stays inside the root menu so outside-click/focus handling
    // remains simple. Convert clamped viewport coordinates to coordinates
    // relative to that positioned ancestor.
    setSubmenuPosition({
      top: viewportTop - menuRect.top,
      left: viewportLeft - menuRect.left,
      maxHeight,
    });
  }, [submenu]);

  const loadMenuData = () => {
    const dataMissing = skills.length === 0 || experts.length === 0 ||
      mcpConfig === null;
    if (loadInFlight.current || (loadAttempted.current && !dataMissing)) return;

    loadAttempted.current = true;
    loadInFlight.current = true;
    setMenuLoading(true);
    const { loadSkills, loadExperts, loadMcp, loadConnectors } =
      useSkillStore.getState();
    void Promise.all([loadSkills(), loadExperts(), loadMcp(), loadConnectors()])
      .finally(() => {
        loadInFlight.current = false;
        setMenuLoading(false);
      });
  };

  const openRootMenu = (options?: { focusFirst?: boolean }) => {
    setActionError(null);
    setOpen(true);
    loadMenuData();
    requestAnimationFrame(() => {
      if (options?.focusFirst) {
        focusMenuItem(menuRef.current, 0);
        return;
      }
      menuRef.current?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    const handleResize = () => updateSubmenuPosition();
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleResize);
    };
  }, [open, updateSubmenuPosition]);

  useLayoutEffect(() => {
    if (!submenu) return;
    setSubmenuPosition(null);
    updateSubmenuPosition();
  }, [
    submenu,
    experts,
    skills,
    mcpConfig,
    connected,
    menuLoading,
    updateSubmenuPosition,
  ]);

  const showSubmenu = (name: SubmenuName, moveFocus = false) => {
    setActionError(null);
    setSubmenu(name);
    if (moveFocus) {
      requestAnimationFrame(() => focusMenuItem(submenuRef.current, 0));
    }
  };

  const handleMenuKeys = (
    event: KeyboardEvent<HTMLElement>,
    menu: HTMLElement | null,
  ) => {
    const items = Array.from(
      menu?.querySelectorAll<HTMLElement>(
        ':scope > [role="menuitem"]:not([aria-disabled="true"]):not(:disabled), :scope > [role="menuitemcheckbox"]:not([aria-disabled="true"]):not(:disabled)',
      ) ?? [],
    );
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusMenuItem(menu, current + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusMenuItem(menu, current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusMenuItem(menu, 0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusMenuItem(menu, items.length - 1);
    }
  };

  const handleRootItem = (id: "file" | "document" | SubmenuName) => {
    if (id === "file") {
      fileInputRef.current?.click();
      return;
    }
    if (id === "document") {
      void selectAndClose(onDocumentProcessingSelected);
      return;
    }
    showSubmenu(id);
  };

  const selectAndClose = async (action: () => void | Promise<void>) => {
    if (actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      await action();
      if (mountedRef.current) close(true);
    } catch (error) {
      if (mountedRef.current) {
        const message = error instanceof Error ? error.message : String(error);
        setActionError(message || "操作失败，请重试");
      }
    } finally {
      if (mountedRef.current) setActionPending(false);
    }
  };

  const connectorNames = Array.from(
    new Set([
      ...Object.keys(mcpConfig?.mcpServers ?? {}),
      ...connected.map((item) => item.name),
    ]),
  );

  const moveFocusOutsideMenu = (backward: boolean) => {
    const tabbable = getTabbableElements();
    const triggerIndex = tabbable.indexOf(triggerRef.current as HTMLElement);
    const target = tabbable[triggerIndex + (backward ? -1 : 1)];
    close();
    requestAnimationFrame(() => target?.focus());
  };

  return (
    <div
      className="composer-plus"
      ref={rootRef}
      onKeyDownCapture={(event) => {
        if (!open || event.key !== "Tab") return;
        event.preventDefault();
        moveFocusOutsideMenu(event.shiftKey);
      }}
      onBlurCapture={() => {
        requestAnimationFrame(() => {
          if (open && !rootRef.current?.contains(document.activeElement)) {
            close();
          }
        });
      }}
    >
      <input
        ref={fileInputRef}
        className="composer-plus__file-input"
        type="file"
        multiple
        accept={ATTACHMENT_INPUT_ACCEPT}
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          if (files.length) onFilesSelected(files);
          event.currentTarget.value = "";
          close(true);
        }}
      />
      <button
        ref={triggerRef}
        type="button"
        className="composer-plus__trigger"
        aria-label="添加内容"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) =>
          open ? close() : openRootMenu({ focusFirst: event.detail === 0 })}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            openRootMenu({ focusFirst: true });
          }
        }}
      >
        <Plus size={17} />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="composer-plus__menu"
          role="menu"
          tabIndex={-1}
          aria-label="添加内容"
          onAnimationEnd={updateSubmenuPosition}
          onKeyDown={(event) => {
            handleMenuKeys(event, menuRef.current);
            if (event.key === "ArrowRight") {
              const id = (document.activeElement as HTMLElement)?.dataset
                .menuId;
              if (id && id !== "file" && id !== "document") {
                event.preventDefault();
                showSubmenu(id as SubmenuName, true);
              }
            }
          }}
        >
          {rootItems.map((item) => {
            const Icon = item.icon;
            const hasSubmenu = item.id !== "file" && item.id !== "document";
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={actionPending}
                data-menu-id={item.id}
                className={`composer-plus__item ${
                  submenu === item.id ? "is-active" : ""
                }`}
                aria-haspopup={hasSubmenu ? "menu" : undefined}
                aria-expanded={hasSubmenu ? submenu === item.id : undefined}
                onMouseEnter={() =>
                  hasSubmenu
                    ? showSubmenu(item.id as SubmenuName)
                    : setSubmenu(null)}
                onFocus={() => {
                  if (!hasSubmenu) {
                    setSubmenu(null);
                  } else if (submenu !== null) {
                    showSubmenu(item.id as SubmenuName);
                  }
                }}
                onClick={() => handleRootItem(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {hasSubmenu && (
                  <ChevronRight className="composer-plus__chevron" size={15} />
                )}
              </button>
            );
          })}

          {submenu && (
            <div
              ref={submenuRef}
              className="composer-plus__submenu"
              role="menu"
              aria-label={`${
                rootItems.find((item) => item.id === submenu)?.label
              }选项`}
              style={{
                top: submenuPosition?.top ?? 8,
                left: submenuPosition?.left ?? 8,
                maxHeight: submenuPosition?.maxHeight ?? "calc(100vh - 16px)",
                visibility: submenuPosition ? "visible" : "hidden",
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                handleMenuKeys(event, submenuRef.current);
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  setSubmenu(null);
                  const index = rootItems.findIndex((item) =>
                    item.id === submenu
                  );
                  requestAnimationFrame(() =>
                    focusMenuItem(menuRef.current, index)
                  );
                }
              }}
            >
              {submenu === "mode" && (
                <>
                  <MenuHeading>选择模式</MenuHeading>
                  {MODES.map((item) => (
                    <button
                      key={item.mode}
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      className="composer-plus__detail-item"
                      disabled={actionPending}
                      onClick={() => {
                        void selectAndClose(() => onModeSelected(item.mode));
                      }}
                    >
                      <span className="composer-plus__detail-copy">
                        <strong>{item.name}</strong>
                        <small>{item.description}</small>
                      </span>
                      {mode === item.mode && <Check size={16} />}
                    </button>
                  ))}
                </>
              )}

              {submenu === "expert" && (
                <>
                  <MenuHeading>选择专家</MenuHeading>
                  {menuLoading && experts.length === 0
                    ? <MenuStatus>正在加载专家…</MenuStatus>
                    : experts.length
                    ? (
                      experts.map((expert) => (
                        <button
                          key={expert.id}
                          type="button"
                          role="menuitem"
                          tabIndex={-1}
                          disabled={actionPending}
                          data-expert-id={expert.id}
                          className="composer-plus__detail-item"
                          onClick={() => {
                            void selectAndClose(() => onExpertSelected(expert));
                          }}
                        >
                          <ExpertAvatar icon={expert.icon} name={expert.name} />
                          <span className="composer-plus__detail-copy">
                            <strong>{expert.name}</strong>
                            <small>
                              {expert.description || expert.nickname ||
                                "开始专家对话"}
                            </small>
                          </span>
                        </button>
                      ))
                    )
                    : <MenuStatus>暂无可用专家</MenuStatus>}
                  {actionPending && <MenuStatus>正在创建专家对话…</MenuStatus>}
                  {actionError && <MenuError>{actionError}</MenuError>}
                </>
              )}

              {submenu === "skill" && (
                <>
                  <MenuHeading>选择技能</MenuHeading>
                  {menuLoading && skills.length === 0
                    ? <MenuStatus>正在加载技能…</MenuStatus>
                    : skills.length
                    ? (
                      skills.map((skill) => {
                        const isSelected = selectedSkillKeys.has(
                          skill.name.trim().toLowerCase(),
                        );
                        const isSelectionDisabled =
                          actionPending ||
                          skillSelectionLocked ||
                          (skillSelectionAtLimit && !isSelected);
                        return (
                        <button
                          key={skill.name}
                          type="button"
                          role="menuitemcheckbox"
                          tabIndex={-1}
                          disabled={isSelectionDisabled}
                          data-skill-name={skill.name}
                          aria-checked={isSelected}
                          className={`composer-plus__detail-item ${
                            isSelected ? "is-selected" : ""
                          }`}
                          onClick={() => {
                            if (isDocumentProcessingCapability(skill.name)) {
                              void selectAndClose(onDocumentProcessingSelected);
                              return;
                            }
                            // Expert creator selections remain in this submenu
                            // so several business skills can be chosen in sequence.
                            if (
                              !isSelectionDisabled &&
                              !isSelected
                            ) {
                              onSkillSelected(skill);
                            }
                          }}
                        >
                          <span
                            className="composer-plus__skill-glyph"
                            style={{
                              "--skill-icon-hue": skillIconHue(skill.name),
                            } as CSSProperties}
                          >
                            {skillInitial(skill)}
                          </span>
                          <span className="composer-plus__detail-copy">
                            <strong>{skill.displayName || skill.name}</strong>
                            <small>
                              {skill.description || `/${skill.name}`}
                            </small>
                          </span>
                          {isSelected && <Check size={16} />}
                        </button>
                        );
                      })
                    )
                    : <MenuStatus>暂无已启用技能</MenuStatus>}
                </>
              )}

              {submenu === "connector" && (
                <>
                  <MenuHeading>连接器</MenuHeading>
                  {enterpriseConnectorError && (
                    <MenuError>{enterpriseConnectorError}</MenuError>
                  )}
                  {menuLoading && connectorNames.length === 0
                    ? <MenuStatus>正在加载连接器…</MenuStatus>
                    : connectorNames.length
                    ? (
                      connectorNames.map((name) => {
                        const serverConfig = mcpConfig?.mcpServers[name];
                        const connection = connected.find((item) =>
                          item.name === name
                        );
                        const logo = connectorLogo({ id: name });
                        const isSelected = selectedConnectorNames.includes(name);
                        const isDisabled = serverConfig?.disabled === true ||
                          serverConfig?.enabled === false;
                        const isConnected = Boolean(connection) && !isDisabled;
                        return (
                          <button
                            key={name}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={isSelected}
                            tabIndex={-1}
                            disabled={actionPending || isDisabled}
                            data-connector-state={isConnected
                              ? "connected"
                              : isDisabled
                              ? "disabled"
                              : "unconnected"}
                            className="composer-plus__detail-item"
                            onClick={() => {
                              if (isDisabled) return;
                              void selectAndClose(() =>
                                onConnectorSelected(name)
                              );
                            }}
                          >
                            {logo ? <img className="composer-plus__connector-logo" src={logo} alt="" /> : <span
                              className={`composer-plus__status-dot ${
                                isConnected
                                  ? "is-connected"
                                  : isDisabled
                                  ? "is-disabled"
                                  : ""
                              }`}
                            />}
                            <span className="composer-plus__detail-copy">
                              <strong>
                                {serverConfig?.displayName ||
                                  connection?.displayName || name}
                              </strong>
                              <small>
                                {isDisabled
                                  ? "已停用"
                                  : isConnected && connection
                                  ? `已连接 · ${connection.toolCount} 个工具`
                                  : "任务运行时在沙箱中连接"}
                              </small>
                            </span>
                            {isSelected && <Check size={16} />}
                          </button>
                        );
                      })
                    )
                    : <MenuStatus>尚未配置连接器</MenuStatus>}
                  <div className="composer-plus__separator" />
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    disabled={actionPending}
                    className="composer-plus__detail-item"
                    onClick={() => {
                      void selectAndClose(onOpenConnectorManager);
                    }}
                  >
                    <Settings2 size={16} />
                    <span className="composer-plus__detail-copy">
                      <strong>管理连接器</strong>
                      <small>添加或调整 MCP 服务</small>
                    </span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MenuHeading({ children }: { children: string }) {
  return <div className="composer-plus__heading">{children}</div>;
}

function MenuStatus({ children }: { children: string }) {
  return <div className="composer-plus__status">{children}</div>;
}

function MenuError({ children }: { children: string }) {
  return (
    <div className="composer-plus__error" role="alert">
      {children}
    </div>
  );
}
