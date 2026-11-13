import type { GcalViewId } from "./calendarViewStorage";

export function rangeIso(start: Date, end: Date) {
  return { from: start.toISOString(), to: end.toISOString() };
}

/** Approximate FullCalendar visible window for the active view (datesSet refines it). */
export function initialVisibleRange(view: GcalViewId, now = new Date()): { from: string; to: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);

  if (view === "dayGridMonth") {
    start.setDate(1);
    end.setMonth(start.getMonth() + 1);
    end.setDate(1);
    return rangeIso(start, end);
  }

  if (view === "timeGridDay") {
    end.setDate(end.getDate() + 1);
    return rangeIso(start, end);
  }

  if (view === "timeGrid3Day") {
    end.setDate(end.getDate() + 3);
    return rangeIso(start, end);
  }

  // timeGridWeek / listWeek — Monday-based week (FullCalendar will correct via datesSet).
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset);
  end.setTime(start.getTime());
  end.setDate(end.getDate() + 7);
  return rangeIso(start, end);
}
