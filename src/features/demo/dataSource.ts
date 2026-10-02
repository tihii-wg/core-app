import { useSyncExternalStore } from "react";

/**
 * Shape every module-level data hook returns, whether it reads Supabase or demo records.
 * `isDemo` lets the UI label sample data so it is never mistaken for workspace data.
 */
export type DataSourceResult<T> = {
  data: T;
  isLoading: boolean;
  error: Error | null;
  isDemo: boolean;
};

export type DemoStore<T> = {
  get: () => T;
  update: (change: (current: T) => T) => void;
  subscribe: (listener: () => void) => () => void;
  reset: () => void;
};

/** In-memory store for demo records. It lives for the browser session only and never touches Supabase. */
export function createDemoStore<T>(initial: T): DemoStore<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    get: () => state,
    update(change) {
      state = change(state);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      state = initial;
      notify();
    },
  };
}

export function useDemoStore<T>(store: DemoStore<T>) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function simulateDemoLatency(ms = 500) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
