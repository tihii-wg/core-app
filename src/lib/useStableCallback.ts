import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A function with a fixed identity that always calls the latest `fn`. Lets memoized list rows
 * (React.memo cards) skip re-rendering when the page re-renders for unrelated state — e.g. opening
 * a "create" dialog — while their handlers still see the current state when they are called.
 * Only for event handlers (called after render), never for values used during render.
 */
export function useStableCallback<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: Args) => ref.current(...args), []);
}
