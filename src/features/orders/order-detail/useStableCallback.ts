import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Stable callback identity that always invokes the latest `handler`.
 * Use for memoized children props so parents do not recreate callbacks every render.
 */
export function useStableCallback<Args extends unknown[], R>(handler: (...args: Args) => R): (...args: Args) => R {
  const ref = useRef(handler);
  useLayoutEffect(() => {
    ref.current = handler;
  });
  return useCallback((...args: Args) => ref.current(...args), []);
}

type AnyHandler = (...args: never[]) => unknown;

/**
 * A fixed set of event handlers with stable identities (created once) that always call the latest version.
 * For EVENT handlers only (clicks, saves, selects) — never for functions children call while rendering.
 * The key set must not change between renders.
 */
export function useStableHandlers<T extends Record<string, AnyHandler>>(handlers: T): T {
  const ref = useRef(handlers);
  useLayoutEffect(() => {
    ref.current = handlers;
  });
  const [stable] = useState(() => {
    const out = {} as Record<string, AnyHandler>;
    for (const key of Object.keys(handlers)) {
      out[key] = (...args: never[]) => (ref.current[key] as AnyHandler)(...args);
    }
    return out as T;
  });
  return stable;
}
