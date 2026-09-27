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

export function isAtOrBelowMinimum(item: { quantity: number; minQuantity: number }) {
  return item.quantity <= item.minQuantity;
}

export function clientCreatedAt(client: unknown) {
  if (!client || typeof client !== "object" || !("created_at" in client)) return "";
  const createdAt = client.created_at;
  return typeof createdAt === "string" ? createdAt : "";
}
