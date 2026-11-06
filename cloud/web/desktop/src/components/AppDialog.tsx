import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp } from "lucide-react";
import { useStore } from "../store/useStore";
import "./AppDialog.css";

export default function AppDialog() {
  const { pendingUiDialog, resolveUiDialog } = useStore();
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pendingUiDialog) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      confirmButtonRef.current?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        resolveUiDialog(pendingUiDialog.kind === "alert");
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [pendingUiDialog?.id, resolveUiDialog]);

  if (!pendingUiDialog) return null;

  const isDanger = pendingUiDialog.tone === "danger";
  const Icon = isDanger
    ? AlertTriangle
    : pendingUiDialog.tone === "success"
    ? CheckCircle2
    : CircleHelp;

  return (
    <div
      className="app-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          resolveUiDialog(pendingUiDialog.kind === "alert");
        }
      }}
    >
      <section
        className="app-dialog-card"
        role={isDanger ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        aria-describedby="app-dialog-message"
      >
        <div
          className={`app-dialog-icon app-dialog-icon--${
            pendingUiDialog.tone ?? "default"
          }`}
        >
          <Icon size={20} />
        </div>

        <div className="app-dialog-content">
          <h2 id="app-dialog-title" className="app-dialog-title">
            {pendingUiDialog.title}
          </h2>
          <p id="app-dialog-message" className="app-dialog-message">
            {pendingUiDialog.message}
          </p>
        </div>

        <div className="app-dialog-actions">
          {pendingUiDialog.kind === "confirm" && (
            <button
              type="button"
              className="app-dialog-button app-dialog-button--secondary"
              onClick={() => resolveUiDialog(false)}
            >
              {pendingUiDialog.cancelLabel}
            </button>
          )}
          <button
            ref={confirmButtonRef}
            type="button"
            className={`app-dialog-button ${
              isDanger
                ? "app-dialog-button--danger"
                : "app-dialog-button--primary"
            }`}
            onClick={() => resolveUiDialog(true)}
          >
            {pendingUiDialog.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
