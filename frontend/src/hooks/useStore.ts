import { useRef, useSyncExternalStore } from "react";
import { getState, subscribe, type AppState } from "../stores/store";

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object), kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/**
 * Đọc một lát cắt của store; component chỉ re-render khi lát cắt đổi.
 * Kết quả selector được cache theo shallow-equal, nên selector có thể trả về
 * mảng/object mới (vd. filter) mà không gây vòng lặp render của useSyncExternalStore.
 */
export function useStore<T>(selector: (s: AppState) => T): T {
  const last = useRef<{ value: T } | null>(null);
  const get = (): T => {
    const next = selector(getState());
    if (last.current && shallowEqual(last.current.value, next)) return last.current.value;
    last.current = { value: next };
    return next;
  };
  return useSyncExternalStore(subscribe, get, get);
}
