import i18n, { currentIntlLocale } from "../i18n";
import { financeDateKey } from "../features/finance/financeStats";
import {
  isValidLedgerPayment,
  netCollected,
  orderPaymentBalance,
} from "../features/finance/paymentCalculations";
import type { LedgerPayment } from "../features/finance/paymentTypes";

export type WeekDayStat = {
  date: string;
  /** Narrow weekday name in the UI language, e.g. "M" in English. */
  label: string;
  count: number;
};

export type TaskOverviewCounts = {
  inProgress: number;
  waitingParts: number;
  completedToday: number;
  total: number;
};

type OverviewOrder = {
  status: string;
  updatedAt: string;
};

type WeekOrder = {
  id?: string;
  createdAt: string;
  isPaid: boolean;
  status: string;
  totalPrice: number;
};

type WeekClient = {
  createdAt: string;
};

export function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function calendarDateKey(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return localDateKey(parsed);
}

export function startOfWeek(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysFromMonday = start.getDay() === 0 ? 6 : start.getDay() - 1;
  start.setDate(start.getDate() - daysFromMonday);
  return start;
}

export function weekDateKeys(now: Date) {
  const start = startOfWeek(now);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return localDateKey(day);
  });
}

export function taskOverviewCounts(orders: OverviewOrder[], today: string): TaskOverviewCounts {
  const inProgress = orders.filter((order) => order.status === "in-progress").length;
  const waitingParts = orders.filter((order) => order.status === "waiting-parts").length;
  const completedToday = orders.filter((order) => order.status === "completed" && order.updatedAt === today).length;
  return {
    inProgress,
    waitingParts,
    completedToday,
    total: inProgress + waitingParts + completedToday,
  };
}

/**
 * Week order counts stay by order createdAt.
 * Revenue is cash collected this week by payments.paidAt (ledger net), not order.isPaid.
 */
export function thisWeekStats(
  orders: WeekOrder[],
  clients: WeekClient[],
  now: Date,
  payments: LedgerPayment[] = [],
) {
  const dates = weekDateKeys(now);
  const daysInWeek = new Set(dates);
  const weekOrders = orders.filter((order) => daysInWeek.has(order.createdAt));
  const weekday = new Intl.DateTimeFormat(currentIntlLocale(), { weekday: "narrow" });
  const days: WeekDayStat[] = dates.map((date) => ({
    date,
    label: weekday.format(new Date(`${date}T00:00:00`)),
    count: weekOrders.filter((order) => order.createdAt === date).length,
  }));
  const newClients = clients.filter((client) => daysInWeek.has(calendarDateKey(client.createdAt))).length;
  const weekPayments = payments.filter((row) => {
    if (!isValidLedgerPayment(row)) return false;
    const paidDay = financeDateKey(row.paidAt);
    return paidDay !== "" && daysInWeek.has(paidDay);
  });
  const revenue = netCollected(weekPayments);

  return {
    days,
    revenue,
    orders: weekOrders.length,
    newClients,
    isEmpty: weekOrders.length === 0 && newClients === 0,
  };
}

type MoneyOrder = {
  id?: string;
  createdAt: string;
  isPaid: boolean;
  status: string;
  totalPrice: number;
};

/**
 * Cash collected today vs yesterday by payments.paidAt (ledger net).
 * `paidOrders` = distinct orders with a payment row dated that day.
 */
export function todayRevenueStats(orders: MoneyOrder[], now: Date, payments: LedgerPayment[] = []) {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const todayKey = localDateKey(now);
  const yesterdayKey = localDateKey(yesterday);

  const receiptsOn = (dateKey: string) =>
    netCollected(
      payments.filter((row) => isValidLedgerPayment(row) && financeDateKey(row.paidAt) === dateKey),
    );

  const revenue = receiptsOn(todayKey);
  const previous = receiptsOn(yesterdayKey);
  const paidOrderIds = new Set(
    payments
      .filter((row) => row.kind === "payment" && isValidLedgerPayment(row) && financeDateKey(row.paidAt) === todayKey)
      .map((row) => row.orderId)
      .filter((id): id is string => Boolean(id)),
  );
  // Keep orders in the signature so callers stay compatible; unused for cash math.
  void orders;

  return {
    revenue,
    paidOrders: paidOrderIds.size,
    // Without revenue yesterday there is no meaningful baseline for a percentage.
    changeVsYesterday: previous > 0 ? ((revenue - previous) / previous) * 100 : null,
  };
}

/**
 * Outstanding / awaiting payment from the ledger remaining (orderPaymentBalance).
 * Cancelled and closed orders stay excluded. Partial payments contribute only their remainder.
 */
export function outstandingPaymentStats(orders: MoneyOrder[], payments: LedgerPayment[] = []) {
  const balanceOf = (order: MoneyOrder) =>
    orderPaymentBalance(
      {
        id: order.id ?? "",
        totalPrice: order.totalPrice,
        isPaid: order.isPaid,
        status: order.status as import("../lib/types").OrderStatus,
      },
      payments,
    );
  const unpaid = orders.filter((order) => {
    if (order.status === "cancelled" || order.status === "closed") return false;
    return balanceOf(order).remaining > 0.005;
  });
  return {
    amount: unpaid.reduce((sum, order) => sum + balanceOf(order).remaining, 0),
    orders: unpaid.length,
  };
}

type ActivityOrder = {
  id: string;
  orderNumber: string;
  clientName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type ActivityClient = {
  id: string;
  name: string;
  created_at?: string;
};

export type ActivityItem =
  | { key: string; kind: "order-created" | "order-updated"; date: string; orderId: string; orderNumber: string; clientName: string; status: string }
  | { key: string; kind: "client-created"; date: string; clientId: string; clientName: string };

export function recentActivity(orders: ActivityOrder[], clients: ActivityClient[], limit = 6): ActivityItem[] {
  const events: { event: ActivityItem; tiebreak: string }[] = [];

  for (const order of orders) {
    const base = { orderId: order.id, orderNumber: order.orderNumber, clientName: order.clientName, status: order.status };
    if (order.createdAt) events.push({ event: { ...base, key: `order-created-${order.id}`, kind: "order-created", date: order.createdAt }, tiebreak: order.orderNumber });
    if (order.updatedAt && order.createdAt && order.updatedAt > order.createdAt) {
      events.push({ event: { ...base, key: `order-updated-${order.id}`, kind: "order-updated", date: order.updatedAt }, tiebreak: order.orderNumber });
    }
  }

  for (const client of clients) {
    const date = calendarDateKey(client.created_at ?? "");
    if (date) events.push({ event: { key: `client-created-${client.id}`, kind: "client-created", date, clientId: client.id, clientName: client.name }, tiebreak: client.created_at ?? "" });
  }

  return events
    .sort((a, b) => b.event.date.localeCompare(a.event.date) || b.tiebreak.localeCompare(a.tiebreak))
    .slice(0, limit)
    .map(({ event }) => event);
}

export function relativeDayLabel(dateKey: string, now: Date) {
  const today = localDateKey(now);
  if (dateKey === today) return i18n.t("dashboard.activity.today");
  if (dateKey === localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return i18n.t("dashboard.activity.yesterday");
  const date = dateFromKey(dateKey);
  if (!date) return "";
  return date.toLocaleDateString(currentIntlLocale(), date.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

function dateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

/**
 * Whether an inventory row should appear in dashboard low-stock lists.
 * Derived from quantity vs minQuantity (same rules as inventory_items_with_status).
 * Inactive items never qualify.
 */
export function isAtOrBelowMinimum(item: {
  quantity: number;
  minQuantity: number;
  isActive?: boolean;
  stockStatus?: "in_stock" | "low_stock" | "out_of_stock";
}) {
  if (item.isActive === false) return false;
  if (item.quantity <= 0) return true;
  // min_quantity 0 disables low_stock (only out_of_stock at qty <= 0) — matches the DB view.
  if (item.minQuantity <= 0) return false;
  return item.quantity <= item.minQuantity;
}

export function clientCreatedAt(client: unknown) {
  if (!client || typeof client !== "object" || !("created_at" in client)) return "";
  const createdAt = client.created_at;
  return typeof createdAt === "string" ? createdAt : "";
}
