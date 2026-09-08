import { dismissToast, useToasts } from "../hooks/useToast";

export function Toasts() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.text}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="Dismiss">×</button>
        </div>
      ))}
    </div>
  );
}
