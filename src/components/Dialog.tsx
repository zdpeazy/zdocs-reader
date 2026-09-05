import { X } from "lucide-react";
import { useEffect } from "react";

export interface DialogAction {
  label: string;
  onClick: () => void | Promise<void>;
  variant?: "primary" | "danger" | "secondary";
}

export function Dialog({ title, description, actions, onClose }: { title: string; description: React.ReactNode; actions: DialogAction[]; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">
        <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭"><X size={17} /></button>
        <h2 id="dialog-title">{title}</h2>
        <div className="dialog-description">{description}</div>
        <div className="dialog-actions">
          {actions.map((action) => <button key={action.label} type="button" className={`dialog-action ${action.variant ?? "secondary"}`} onClick={action.onClick}>{action.label}</button>)}
        </div>
      </section>
    </div>
  );
}
