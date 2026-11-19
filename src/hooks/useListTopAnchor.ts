import { useCallback, useRef } from "react";

/** Sticky top bar (h-14) + a small gap, so the list starts right under it. */
const TOP_OFFSET_PX = 64;

/**
 * Anchor for a paginated list: after a page switch `scrollToListTop()` puts the start of the list at the top
 * of the screen (just under the sticky top bar). Filters and search above it scroll out of view; the user can
 * scroll back up to them.
 */
export function useListTopAnchor<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const scrollToListTop = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    // After the page state is applied (same frame as the new rows / placeholder).
    requestAnimationFrame(() => {
      const top = element.getBoundingClientRect().top + window.scrollY - TOP_OFFSET_PX;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
  }, []);
  return { ref, scrollToListTop };
}
