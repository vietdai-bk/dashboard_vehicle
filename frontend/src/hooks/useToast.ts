import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  kind: "info" | "success" | "warning" | "error";
  text: string;
}
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function toast(kind: Toast["kind"], text: string, ttl = 4000): void {
  const id = nextId++;
  toasts = [...toasts, { id, kind, text }];
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, ttl);
}
export const dismissToast = (id: number): void => {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};
export function useToasts(): Toast[] {
  return useSyncExternalStore((fn) => (listeners.add(fn), () => listeners.delete(fn)), () => toasts, () => toasts);
}
