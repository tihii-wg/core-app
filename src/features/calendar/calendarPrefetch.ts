import type { CalendarApi } from "@fullcalendar/core";

export type ActiveRangeIso = { from: string; to: string };

/**
 * Peek the activeStart/activeEnd FullCalendar would use after prev/next
 * without leaving a visible flash (batchRendering).
 */
export function peekAdjacentActiveRange(
  api: CalendarApi,
  direction: "prev" | "next",
): ActiveRangeIso | null {
  try {
    const current = api.getDate();
    let from = "";
    let to = "";
    api.batchRendering(() => {
      if (direction === "next") api.next();
      else api.prev();
      from = api.view.activeStart.toISOString();
      to = api.view.activeEnd.toISOString();
      api.gotoDate(current);
    });
    if (!from || !to) return null;
    return { from, to };
  } catch {
    return null;
  }
}
