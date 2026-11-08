import type { Order } from "../../lib/types";
import type { IndustryOrderFieldBlocks } from "../industries/industryProfile";
import { localDateKey, startOfWeek } from "../../pages/dashboardStats";

/** Calendar granularity of the Orders calendar view. */
export const ORDER_CALENDAR_SCALES = ["month", "week"] as const;
export type OrderCalendarScale = (typeof ORDER_CALENDAR_SCALES)[number];
export const ORDER_CALENDAR_SCALE_STORAGE_KEY = "coreapp.orders.calendarScale";

export function readOrderCalendarScale(): OrderCalendarScale {
  try {
    return window.localStorage.getItem(ORDER_CALENDAR_SCALE_STORAGE_KEY) === "week" ? "week" : "month";
  } catch {
    return "month";
  }
}

export function writeOrderCalendarScale(scale: OrderCalendarScale) {
  try {
    window.localStorage.setItem(ORDER_CALENDAR_SCALE_STORAGE_KEY, scale);
  } catch {
    // Storage may be unavailable (private mode, test stubs).
  }
}

/** Which order field placed the order on the calendar. */
export type OrderCalendarBasis = "deadline" | "createdAt";

/** Calendar event kinds — deadline/createdAt plus project measurement/installation. */
export type OrderCalendarEventKind = OrderCalendarBasis | "measurement" | "installation";

export type OrderCalendarEvent<T extends Pick<Order, "orderNumber"> = Order> = {
  id: string;
  order: T;
  dateKey: string;
  kind: OrderCalendarEventKind;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function dateKeyOf(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (DATE_KEY.test(trimmed)) return trimmed;
  // Tolerate full ISO timestamps (orders map them to YYYY-MM-DD already, fixtures may not).
  if (trimmed.length >= 10 && DATE_KEY.test(trimmed.slice(0, 10))) return trimmed.slice(0, 10);
  return "";
}

/**
 * Day an order is listed on: its deadline, else its creation date.
 * `null` when the order has neither (it is shown in the "no date" list).
 */
export function orderCalendarPlacement(order: Pick<Order, "deadline" | "createdAt">): { dateKey: string; basis: OrderCalendarBasis } | null {
  const deadline = dateKeyOf(order.deadline);
  if (deadline) return { dateKey: deadline, basis: "deadline" };
  const created = dateKeyOf(order.createdAt);
  if (created) return { dateKey: created, basis: "createdAt" };
  return null;
}

export type OrderCalendarBuckets<T extends Pick<Order, "deadline" | "createdAt" | "orderNumber">> = {
  byDate: Map<string, T[]>;
  /** Orders with neither a deadline nor a creation date. */
  undated: T[];
};

/** Groups orders by calendar day (see `orderCalendarPlacement`). Orders within a day are sorted by number. */
export function bucketOrdersByDate<T extends Pick<Order, "deadline" | "createdAt" | "orderNumber">>(orders: readonly T[]): OrderCalendarBuckets<T> {
  const byDate = new Map<string, T[]>();
  const undated: T[] = [];

  for (const order of orders) {
    const placement = orderCalendarPlacement(order);
    if (!placement) {
      undated.push(order);
      continue;
    }
    const bucket = byDate.get(placement.dateKey);
    if (bucket) bucket.push(order);
    else byDate.set(placement.dateKey, [order]);
  }

  const byNumber = (a: T, b: T) => a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true });
  for (const bucket of byDate.values()) bucket.sort(byNumber);
  undated.sort(byNumber);
  return { byDate, undated };
}

type OrderCalendarEventSource = Pick<
  Order,
  "id" | "orderNumber" | "deadline" | "createdAt" | "measurementAt" | "installationAt"
>;

/**
 * Expands orders into calendar events. Project industries also get measurement /
 * installation appointments as separate events (in addition to the deadline).
 */
export function expandOrderCalendarEvents<T extends OrderCalendarEventSource>(
  orders: readonly T[],
  blocks: Pick<IndustryOrderFieldBlocks, "measurementAt" | "installationAt">,
): OrderCalendarEvent<T>[] {
  const events: OrderCalendarEvent<T>[] = [];
  const showMeasurement = blocks.measurementAt;
  const showInstallation = blocks.installationAt;

  for (const order of orders) {
    const placement = orderCalendarPlacement(order);
    if (placement) {
      events.push({
        id: `${order.id}:${placement.basis}`,
        order,
        dateKey: placement.dateKey,
        kind: placement.basis,
      });
    }

    if (showMeasurement) {
      const measureKey = dateKeyOf(order.measurementAt);
      if (measureKey) {
        events.push({
          id: `${order.id}:measurement`,
          order,
          dateKey: measureKey,
          kind: "measurement",
        });
      }
    }

    if (showInstallation) {
      const installKey = dateKeyOf(order.installationAt);
      if (installKey) {
        events.push({
          id: `${order.id}:installation`,
          order,
          dateKey: installKey,
          kind: "installation",
        });
      }
    }
  }

  return events;
}

export type OrderCalendarEventBuckets<T extends Pick<Order, "orderNumber"> = Order> = {
  byDate: Map<string, OrderCalendarEvent<T>[]>;
  undated: OrderCalendarEvent<T>[];
};

/** Groups expanded calendar events by day. Undated = orders with no deadline/createdAt and no project dates. */
export function bucketOrderCalendarEvents<T extends OrderCalendarEventSource>(
  orders: readonly T[],
  blocks: Pick<IndustryOrderFieldBlocks, "measurementAt" | "installationAt">,
): OrderCalendarEventBuckets<T> {
  const events = expandOrderCalendarEvents(orders, blocks);
  const byDate = new Map<string, OrderCalendarEvent<T>[]>();
  const ordersWithEvents = new Set(events.map((event) => event.order.id));
  const undated: OrderCalendarEvent<T>[] = [];

  for (const event of events) {
    const bucket = byDate.get(event.dateKey);
    if (bucket) bucket.push(event);
    else byDate.set(event.dateKey, [event]);
  }

  const kindRank: Record<OrderCalendarEventKind, number> = {
    measurement: 0,
    installation: 1,
    deadline: 2,
    createdAt: 3,
  };
  const bySort = (a: OrderCalendarEvent<T>, b: OrderCalendarEvent<T>) => {
    const numberCmp = a.order.orderNumber.localeCompare(b.order.orderNumber, undefined, { numeric: true });
    if (numberCmp !== 0) return numberCmp;
    return kindRank[a.kind] - kindRank[b.kind];
  };
  for (const bucket of byDate.values()) bucket.sort(bySort);

  for (const order of orders) {
    if (ordersWithEvents.has(order.id)) continue;
    undated.push({
      id: `${order.id}:undated`,
      order,
      dateKey: "",
      kind: "deadline",
    });
  }
  undated.sort((a, b) => a.order.orderNumber.localeCompare(b.order.orderNumber, undefined, { numeric: true }));

  return { byDate, undated };
}

/** First day of the month containing `anchor` (local time, midnight). */
export function startOfMonth(anchor: Date) {
  return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
}

/** Monday-first weeks of date keys. A month grid covers every week the month touches (4–6 rows). */
export function calendarWeeks(anchor: Date, scale: OrderCalendarScale): string[][] {
  const weekDays = (monday: Date) =>
    Array.from({ length: 7 }, (_, index) => localDateKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index)));

  if (scale === "week") return [weekDays(startOfWeek(anchor))];

  const first = startOfMonth(anchor);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const weeks: string[][] = [];
  for (let monday = startOfWeek(first); monday <= last; monday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7)) {
    weeks.push(weekDays(monday));
  }
  return weeks;
}

/** Inclusive first/last date key rendered by the grid (leading/trailing days of neighbouring months included). */
export function calendarRange(anchor: Date, scale: OrderCalendarScale): { from: string; to: string } {
  const weeks = calendarWeeks(anchor, scale);
  return { from: weeks[0][0], to: weeks[weeks.length - 1][6] };
}

/** Moves the anchor one month / week back (-1) or forward (+1). Month moves clamp to day 1 to avoid overflow. */
export function shiftCalendarAnchor(anchor: Date, scale: OrderCalendarScale, delta: -1 | 1) {
  if (scale === "week") return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + delta * 7);
  return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
}

/** Parses YYYY-MM-DD into a local-time Date (midnight); null when malformed. */
export function dateFromKey(key: string) {
  if (!DATE_KEY.test(key)) return null;
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** True when `dateKey` belongs to the same month as `anchor` (grid padding days are dimmed). */
export function isInAnchorMonth(dateKey: string, anchor: Date) {
  return dateKey.startsWith(`${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}-`);
}

/** Orders that fall inside the rendered range, as a flat count (used for the empty-state hint). */
export function countOrdersInRange<T extends Pick<Order, "deadline" | "createdAt" | "orderNumber">>(
  buckets: OrderCalendarBuckets<T>,
  range: { from: string; to: string },
) {
  let total = 0;
  for (const [key, list] of buckets.byDate) {
    if (key >= range.from && key <= range.to) total += list.length;
  }
  return total;
}

/** Calendar events that fall inside the rendered range (deadline + project appointments). */
export function countCalendarEventsInRange<T extends Pick<Order, "orderNumber">>(
  buckets: OrderCalendarEventBuckets<T>,
  range: { from: string; to: string },
) {
  let total = 0;
  for (const [key, list] of buckets.byDate) {
    if (key >= range.from && key <= range.to) total += list.length;
  }
  return total;
}
