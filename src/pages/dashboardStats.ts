const weekdayLabels = ["M", "T", "W", "T", "F", "S", "S"] as const;

export type WeekDayStat = {
  date: string;
  label: (typeof weekdayLabels)[number];
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
  createdAt: string;
  isPaid: boolean;
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

export function thisWeekStats(orders: WeekOrder[], clients: WeekClient[], now: Date) {
  const dates = weekDateKeys(now);
  const daysInWeek = new Set(dates);
  const weekOrders = orders.filter((order) => daysInWeek.has(order.createdAt));
  const days: WeekDayStat[] = dates.map((date, index) => ({
    date,
    label: weekdayLabels[index],
    count: weekOrders.filter((order) => order.createdAt === date).length,
  }));
  const newClients = clients.filter((client) => daysInWeek.has(calendarDateKey(client.createdAt))).length;
  const revenue = weekOrders.filter((order) => order.isPaid).reduce((sum, order) => sum + order.totalPrice, 0);

  return {
    days,
    revenue,
    orders: weekOrders.length,
    newClients,
    isEmpty: weekOrders.length === 0 && newClients === 0,
  };
}

type MoneyOrder = {
  createdAt: string;
  isPaid: boolean;
  status: string;
  totalPrice: number;
};

function paidOrdersOn<T extends MoneyOrder>(orders: T[], dateKey: string) {
  return orders.filter((order) => order.isPaid && order.createdAt === dateKey);
}

/** Revenue uses the same rule as Reports: paid orders, dated by the order's creation day. */
export function todayRevenueStats(orders: MoneyOrder[], now: Date) {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const todayOrders = paidOrdersOn(orders, localDateKey(now));
  const revenue = todayOrders.reduce((sum, order) => sum + order.totalPrice, 0);
  const previous = paidOrdersOn(orders, localDateKey(yesterday)).reduce((sum, order) => sum + order.totalPrice, 0);

  return {
    revenue,
    paidOrders: todayOrders.length,
    // Without revenue yesterday there is no meaningful baseline for a percentage.
    changeVsYesterday: previous > 0 ? ((revenue - previous) / previous) * 100 : null,
  };
}

/** Outstanding uses the same rule as Reports: unpaid orders that are not cancelled. */
export function outstandingPaymentStats(orders: MoneyOrder[]) {
  const unpaid = orders.filter((order) => order.status !== "cancelled" && !order.isPaid);
  return { amount: unpaid.reduce((sum, order) => sum + order.totalPrice, 0), orders: unpaid.length };
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
  if (dateKey === today) return "Today";
  if (dateKey === localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return "Yesterday";
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return "";
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, year === now.getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

export function isAtOrBelowMinimum(item: { quantity: number; minQuantity: number }) {
  return item.quantity <= item.minQuantity;
}

export function clientCreatedAt(client: unknown) {
  if (!client || typeof client !== "object" || !("created_at" in client)) return "";
  const createdAt = client.created_at;
  return typeof createdAt === "string" ? createdAt : "";
}
