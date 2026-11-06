import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

export default function AssistantProcessBundle({
  children,
  durationLabel,
  active = false,
  statusLabel = "正在生成",
  hasDetails = true,
  defaultExpanded = active,
}: {
  children: ReactNode;
  durationLabel: string;
  active?: boolean;
  statusLabel?: string;
  hasDetails?: boolean;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  useEffect(() => setExpanded(defaultExpanded), [defaultExpanded]);
  const label = active ? statusLabel : `已完成${durationLabel}`;
  const summary = <>
    {active && <Loader2 size={14} className="assistant-process-spinner" aria-hidden="true" />}
    <span role={active ? "status" : undefined}>{label}</span>
    {hasDetails && <ChevronDown size={13} className={`assistant-process-chevron${expanded ? " expanded" : ""}`} aria-hidden="true" />}
  </>;
  const body = hasDetails && expanded ? <div className="assistant-process-body">{children}</div> : null;
  return (
    <section className={`assistant-process${active ? " is-active" : ""}`} aria-label="生成过程">
      {active && body}
      {hasDetails ? <button
        type="button"
        className="assistant-process-header"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >{summary}</button> : <div className="assistant-process-header">{summary}</div>}
      {!active && body}
    </section>
  );
}
