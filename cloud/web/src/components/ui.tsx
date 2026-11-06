import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";
import { AlertCircle, Inbox, LoaderCircle, RefreshCw, X } from "lucide-react";

export function Spinner({ label = "正在加载" }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <LoaderCircle size={16} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function Button({
  variant = "default",
  children,
  className = "",
  ...props
}: PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "quiet" | "danger" }
>) {
  return (
    <button className={`button button--${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function StateBlock({
  kind,
  title,
  detail,
  action,
}: {
  kind: "empty" | "error" | "loading";
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  const Icon = kind === "error" ? AlertCircle : kind === "loading" ? LoaderCircle : Inbox;
  return (
    <div className={`state-block state-block--${kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon size={23} aria-hidden="true" />
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
      {action}
    </div>
  );
}

export function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="quiet" onClick={onClick}>
      <RefreshCw size={14} /> 重试
    </Button>
  );
}

export function Modal({
  open,
  title,
  eyebrow,
  onClose,
  children,
  wide = false,
}: PropsWithChildren<{
  open: boolean;
  title: string;
  eyebrow?: string;
  onClose: () => void;
  wide?: boolean;
}>) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal ${wide ? "modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: PropsWithChildren<{ label: string; hint?: string }>) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="toast" role="alert">
      <span>{message}</span>
      <button onClick={onClose} aria-label="关闭提示">
        <X size={15} />
      </button>
    </div>
  );
}
