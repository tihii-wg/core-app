import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { cn } from "../lib/utils";

/** A swipe must start this close to the left edge of the screen (px). */
const EDGE_PX = 24;
/** Horizontal distance that triggers "back" (px). */
const TRIGGER_PX = 80;
/** Arrow travel (px). */
const MAX_PULL_PX = 110;

/** Elements (and their children) where the edge swipe is off, e.g. the calendar grid with its own swipes. */
export const EDGE_SWIPE_IGNORE_ATTR = "data-edge-swipe-ignore";

function isIos() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iOS Safari (not installed to the home screen) already goes back on an edge swipe — avoid going back twice. */
function hasNativeEdgeBack() {
  return isIos() && !isStandalone();
}

/** react-router keeps the in-app history position in history.state.idx. */
function canGoBackInApp() {
  const state = window.history.state as { idx?: unknown } | null;
  return typeof state?.idx === "number" && state.idx > 0;
}

/**
 * Phone / tablet: swipe right from the left edge of the screen = the browser's Back button (in-app history).
 * An arrow follows the finger; vertical movement, an open dialog or an opted-out area cancels it.
 */
export function EdgeSwipeBack() {
  const navigate = useNavigate();
  const [pull, setPull] = useState<{ dx: number; y: number } | null>(null);
  const trackRef = useRef<{ x: number; y: number; dx: number; decided: boolean } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("ontouchstart" in window) || hasNativeEdgeBack()) return;

    const reset = () => {
      trackRef.current = null;
      setPull(null);
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return reset();
      const touch = event.touches[0];
      if (touch.clientX > EDGE_PX || !canGoBackInApp()) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`[${EDGE_SWIPE_IGNORE_ATTR}]`)) return;
      trackRef.current = { x: touch.clientX, y: touch.clientY, dx: 0, decided: false };
    };

    const onMove = (event: TouchEvent) => {
      const track = trackRef.current;
      if (!track) return;
      const touch = event.touches[0];
      const dx = touch.clientX - track.x;
      const dy = touch.clientY - track.y;
      if (!track.decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        // Mostly vertical or leftwards → it is a scroll, not a back swipe.
        if (Math.abs(dy) > Math.abs(dx) || dx <= 0) return reset();
        track.decided = true;
      }
      track.dx = Math.max(0, dx);
      setPull({ dx: Math.min(track.dx, MAX_PULL_PX), y: touch.clientY });
    };

    const onEnd = () => {
      const track = trackRef.current;
      reset();
      if (track?.decided && track.dx >= TRIGGER_PX) navigate(-1);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, [navigate]);

  if (!pull) return null;
  const ready = pull.dx >= TRIGGER_PX;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed left-0 z-[100] flex size-10 items-center justify-center rounded-full shadow-md transition-colors",
        ready ? "bg-primary text-primary-foreground" : "bg-card text-foreground ring-1 ring-border",
      )}
      style={{ top: Math.max(8, pull.y - 20), transform: `translateX(${pull.dx - 44}px)` }}
    >
      <ChevronLeft className="size-5" />
    </div>
  );
}
