import type { GoogleCalendarEvent } from "../../services/apiGoogleCalendar";
import { googleEventToFullCalendar, isAllDayGoogleRange } from "../../services/apiGoogleCalendar";
import type { Order } from "../../lib/types";
import { expandOrderCalendarEvents } from "../orders/orderCalendar";
import type { IndustryOrderFieldBlocks } from "../industries/industryProfile";

export { googleEventToFullCalendar, isAllDayGoogleRange };

/** Normalize FullCalendar date → Google start/end payload. */
export function fullCalendarDateToGoogle(
  start: Date,
  end: Date | null,
  allDay: boolean,
): { start: string; end: string; allDay: boolean } {
  if (allDay) {
    const startKey = toDateKey(start);
    // FullCalendar exclusive end for all-day; Google also uses exclusive end dates.
    const endKey = end ? toDateKey(end) : addDays(startKey, 1);
    return { start: startKey, end: endKey, allDay: true };
  }
  return {
    start: start.toISOString(),
    end: (end ?? new Date(start.getTime() + 60 * 60 * 1000)).toISOString(),
    allDay: false,
  };
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export type CalendarFcEvent = ReturnType<typeof googleEventToFullCalendar> | {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay: true;
  editable: false;
  display?: string;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  extendedProps: {
    kind: "order";
    orderId: string;
    orderNumber: string;
  };
};

export function mapGoogleEventsToFc(
  events: readonly GoogleCalendarEvent[],
  busyTitle = "Busy",
): CalendarFcEvent[] {
  return events.map((ev) => googleEventToFullCalendar(ev, busyTitle));
}

/** Read-only order deadline overlays for the shared calendar. */
export function mapOrdersToFcOverlay(
  orders: readonly Order[],
  blocks: Pick<IndustryOrderFieldBlocks, "measurementAt" | "installationAt">,
): CalendarFcEvent[] {
  return expandOrderCalendarEvents(orders, blocks).map((ev) => ({
    id: `order:${ev.id}`,
    title: ev.order.orderNumber,
    start: ev.dateKey,
    allDay: true as const,
    editable: false as const,
    backgroundColor: "var(--color-info)",
    borderColor: "var(--color-info)",
    textColor: "var(--color-info-foreground, #fff)",
    extendedProps: {
      kind: "order" as const,
      orderId: ev.order.id,
      orderNumber: ev.order.orderNumber,
    },
  }));
}

export function mapApiErrorCode(code: string | undefined): "reconnect_required" | "conflict" | "other" {
  if (code === "reconnect_required") return "reconnect_required";
  if (code === "conflict") return "conflict";
  return "other";
}
