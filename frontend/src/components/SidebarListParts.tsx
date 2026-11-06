import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { t } from "../utils/i18n";

export function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return t("just_now");
  if (m < 60) return `${m} ${t("minutes_ago")}`;
  const h = Math.floor(d / 3600000);
  if (h < 24) return `${h} ${t("hours_ago")}`;
  return `${Math.floor(d / 86400000)} ${t("days_ago")}`;
}

/* ===== 可折叠 Section（任务 / 空间）===== */
export function CollapsibleSection({
  label,
  count,
  defaultOpen = true,
  children,
}: {
  label: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ArrowIcon = open ? ChevronDown : ChevronRight;
  return (
    <div className="sidebar-section">
      <button
        className={`section-header${open ? "" : " is-collapsed"}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="section-header-label">{label}</span>
        <span className="section-header-count">({count})</span>
        <span className="section-header-arrow">
          <ArrowIcon size={12} />
        </span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export function ListPagerFooter({
  remaining,
  showMore,
  showCollapse,
  onExpand,
  onCollapse,
}: {
  remaining: number;
  showMore: boolean;
  showCollapse: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  if (!showMore && !showCollapse) return null;
  return (
    <div className="sidebar-list-pager">
      {showMore && (
        <button type="button" onClick={onExpand}>
          {t("view_more")} ({remaining})
        </button>
      )}
      {showMore && showCollapse && (
        <span className="sidebar-list-pager-sep">|</span>
      )}
      {showCollapse && (
        <button type="button" onClick={onCollapse}>
          {t("collapse_list")}
        </button>
      )}
    </div>
  );
}

