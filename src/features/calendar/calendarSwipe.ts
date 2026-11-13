export type SwipePointerSample = {
  x: number;
  y: number;
  t: number;
};

export type SwipeStartContext = {
  startedOnEvent: boolean;
  pointerCount: number;
  fcBusy: boolean;
};

export type SwipeDecision = "prev" | "next" | null;

const MIN_DX = 60;
const MAX_DURATION_MS = 600;
const DX_OVER_DY = 1.5;

/** Pure swipe detector for calendar period navigation. */
export function decideCalendarSwipe(
  start: SwipePointerSample,
  end: SwipePointerSample,
  ctx: SwipeStartContext,
): SwipeDecision {
  if (ctx.pointerCount > 1) return null;
  if (ctx.startedOnEvent) return null;
  if (ctx.fcBusy) return null;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const duration = end.t - start.t;
  if (duration <= 0 || duration >= MAX_DURATION_MS) return null;
  if (Math.abs(dx) < MIN_DX) return null;
  if (Math.abs(dx) <= DX_OVER_DY * Math.abs(dy)) return null;

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
