import { fullCalendarDateToGoogle } from "./calendarEventMapping";

export type DateClickCreateDraft = {
  start: string;
  end: string;
  allDay: boolean;
};

/**
 * Map a FullCalendar dateClick into a create-event draft.
 * Timed slot → 1 hour; all-day / month day → all-day range.
 */
export function draftFromDateClick(input: {
  date: Date;
  allDay: boolean;
  viewType: string;
}): DateClickCreateDraft {
  const allDay = Boolean(input.allDay) || input.viewType.startsWith("dayGrid");
  if (allDay) {
    const start = new Date(input.date.getFullYear(), input.date.getMonth(), input.date.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return fullCalendarDateToGoogle(start, end, true);
  }
  const start = new Date(input.date.getTime());
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return fullCalendarDateToGoogle(start, end, false);
}
