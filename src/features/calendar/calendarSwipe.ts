export type SwipePointerSample = {
  x: number;
  y: number;
  t: number;
};

export type SwipeStartContext = {
  /** Gesture began on an event chip. Allowed only as a quick swipe (before long-press drag kicks in). */
  startedOnEvent: boolean;
  pointerCount: number;
  fcBusy: boolean;
  /** When true (modal/drawer open), never navigate. */
  blocked?: boolean;
};

export type SwipeDecision = "prev" | "next" | null;

/** Horizontal distance threshold (px). */
export const SWIPE_MIN_DX = 50;
/** High-velocity swipes can commit slightly earlier. */
export const SWIPE_MIN_DX_FAST = 36;
/** px per ms — ~450px/s feels intentional on phones. */
export const SWIPE_MIN_VELOCITY = 0.45;
export const SWIPE_MAX_DURATION_MS = 900;
/** Horizontal must dominate vertical by this ratio (thumb arcs are slightly diagonal). */
export const SWIPE_DX_OVER_DY = 1.2;
/** Matches FullCalendar eventLongPressDelay: holding an event this long means drag, not swipe. */
export const SWIPE_EVENT_LONG_PRESS_MS = 350;

/** Pure swipe detector for calendar period navigation. */
export function decideCalendarSwipe(
  start: SwipePointerSample,
  end: SwipePointerSample,
  ctx: SwipeStartContext,
): SwipeDecision {
  if (ctx.blocked) return null;
  if (ctx.pointerCount > 1) return null;
  if (ctx.fcBusy) return null;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const duration = end.t - start.t;
  if (duration <= 0) return null;
  // Swipes may start on an event (centre of day/week views is usually covered by events),
  // but a long hold on an event is a drag/resize — never navigate then.
  if (ctx.startedOnEvent && duration >= SWIPE_EVENT_LONG_PRESS_MS) return null;

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  // Vertical scroll must win unless horizontal clearly dominates.
  if (absDx <= SWIPE_DX_OVER_DY * absDy) return null;

  const velocity = absDx / duration;
  const fast = velocity >= SWIPE_MIN_VELOCITY && absDx >= SWIPE_MIN_DX_FAST;
  const farEnough = absDx >= SWIPE_MIN_DX;
  if (!farEnough && !fast) return null;
  if (duration >= SWIPE_MAX_DURATION_MS && !fast) return null;

  // Swipe left → next period; swipe right → prev
  return dx < 0 ? "next" : "prev";
}

export function isEventTargetElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(".fc-event, .fc-list-event"));
}

export function isFullCalendarBusy(root: Element | null): boolean {
  if (!root) return false;
  return Boolean(
    root.querySelector(".fc-event-dragging, .fc-event-resizing, .fc-highlight, .fc-mirror"),
  );
}
