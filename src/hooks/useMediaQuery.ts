import { useEffect, useState } from "react";

function getMatches(query: string) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

/**
 * Subscribe to a CSS media query. First render matches the current viewport
 * (no SSR in this app, so reading `window` during init is safe).
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => getMatches(query));

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setMatches(false);
      return;
    }
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
