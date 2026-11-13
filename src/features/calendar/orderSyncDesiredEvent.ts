/** Pure builders for one-way order → Google Calendar events (unit-tested). */

export type SyncField = "deadline" | "measurement" | "installation";

export type OrderSyncSource = {
  id: string;
  number: string;
  kind: string | null;
  status: string | null;
  statusLabel: string;
  cancelled: boolean;
  closed: boolean;
  clientName: string;
  vehicleLabel: string;
  firstServiceName: string;
  itemLines: string[];
  totalLabel: string;
  deadline: string | null;
  measurementAt: string | null;
  installationAt: string | null;
};

export type SyncToggles = {
  syncOrders: boolean;
  syncMeasurement: boolean;
  syncInstallation: boolean;
};

export type DesiredGcalEvent = {
  field: SyncField;
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  timeZone: string | null;
  extendedPrivate: {
    core_app_order_id: string;
    core_app_field: SyncField;
    core_app_workspace_id: string;
  };
};

const TITLE_MAX = 120;

export function localPartsInTimeZone(iso: string, timeZone: string): { dateKey: string; hour: number; minute: number } {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function addOneHourIso(iso: string): string {
  const d = new Date(iso);
  d.setTime(d.getTime() + 60 * 60 * 1000);
  return d.toISOString();
}

function addOneDayKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

export function fieldPrefix(field: SyncField, locale: string): string {
  const lang = locale.slice(0, 2).toLowerCase();
  if (field === "measurement") {
    if (lang === "ro") return "Măsurătoare: ";
    if (lang === "en") return "Measurement: ";
    return "Замер: ";
  }
  if (field === "installation") {
    if (lang === "ro") return "Montaj: ";
    if (lang === "en") return "Installation: ";
    return "Монтаж: ";
  }
  return "";
}

export function buildOrderEventTitle(order: OrderSyncSource, field: SyncField, locale: string): string {
  const vehicleOrService = order.vehicleLabel.trim() || order.firstServiceName.trim();
  const core = [order.number, order.clientName, vehicleOrService].filter(Boolean).join(" · ");
  let title = `${fieldPrefix(field, locale)}${core}`.trim();
  if (order.closed) title = `✓ ${title}`;
  if (title.length > TITLE_MAX) title = `${title.slice(0, TITLE_MAX - 1)}…`;
  return title;
}

const DESCRIPTION_LABELS: Record<string, { status: string; total: string; open: string }> = {
  ru: { status: "Статус", total: "Сумма", open: "Открыть заказ" },
  ro: { status: "Status", total: "Total", open: "Deschide comanda" },
  en: { status: "Status", total: "Total", open: "Open order" },
};

export function buildOrderEventDescription(order: OrderSyncSource, openUrl: string, locale = "ru"): string {
  const l = DESCRIPTION_LABELS[locale.slice(0, 2).toLowerCase()] ?? DESCRIPTION_LABELS.ru!;
  const lines = [
    order.statusLabel ? `${l.status}: ${order.statusLabel}` : null,
    ...order.itemLines.slice(0, 10),
    order.totalLabel ? `${l.total}: ${order.totalLabel}` : null,
    openUrl ? `${l.open}: ${openUrl}` : null,
  ].filter(Boolean) as string[];
  return lines.join("\n");
}

export function dateToEventTimes(
  iso: string,
  timeZone: string,
): { start: string; end: string; allDay: boolean; timeZone: string | null } {
  // Date-only values (order deadline) are stored as 00:00 UTC — that is 02:00/03:00 in Chisinau, so treat
  // exact UTC midnight as an all-day event on that UTC date. Local midnight is all-day too.
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime()) && d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) {
    const dateKey = d.toISOString().slice(0, 10);
    return { start: dateKey, end: addOneDayKey(dateKey), allDay: true, timeZone: null };
  }
  const local = localPartsInTimeZone(iso, timeZone);
  if (local.hour === 0 && local.minute === 0) {
    return {
      start: local.dateKey,
      end: addOneDayKey(local.dateKey),
      allDay: true,
      timeZone: null,
    };
  }
  return {
    start: iso,
    end: addOneHourIso(iso),
    allDay: false,
    timeZone,
  };
}

function fieldEnabled(field: SyncField, toggles: SyncToggles): boolean {
  if (!toggles.syncOrders) return false;
  if (field === "deadline") return true;
  if (field === "measurement") return toggles.syncMeasurement;
  return toggles.syncInstallation;
}

function fieldIso(order: OrderSyncSource, field: SyncField): string | null {
  if (field === "deadline") return order.deadline;
  if (field === "measurement") return order.measurementAt;
  return order.installationAt;
}

/** Desired Google events for one order (empty when estimate/cancelled/deleted/toggles off). */
export function buildDesiredOrderEvents(input: {
  order: OrderSyncSource | null;
  deleted: boolean;
  workspaceId: string;
  toggles: SyncToggles;
  timeZone: string;
  locale: string;
  openUrl: string;
}): DesiredGcalEvent[] {
  const { order, deleted, workspaceId, toggles, timeZone, locale, openUrl } = input;
  if (deleted || !order || !toggles.syncOrders) return [];
  if ((order.kind ?? "order") === "estimate") return [];
  if (order.cancelled) return [];

  const fields: SyncField[] = ["deadline", "measurement", "installation"];
  const out: DesiredGcalEvent[] = [];
  for (const field of fields) {
    if (!fieldEnabled(field, toggles)) continue;
    const iso = fieldIso(order, field)?.trim() || null;
    if (!iso) continue;
    const times = dateToEventTimes(iso, timeZone);
    out.push({
      field,
      title: buildOrderEventTitle(order, field, locale),
      description: buildOrderEventDescription(order, openUrl, locale),
      start: times.start,
      end: times.end,
      allDay: times.allDay,
      timeZone: times.timeZone,
      extendedPrivate: {
        core_app_order_id: order.id,
        core_app_field: field,
        core_app_workspace_id: workspaceId,
      },
    });
  }
  return out;
}

/** Stable hash of the desired payload (skip Google write when unchanged). */
export function hashDesiredEvent(ev: DesiredGcalEvent): string {
  const payload = JSON.stringify({
    field: ev.field,
    title: ev.title,
    description: ev.description,
    start: ev.start,
    end: ev.end,
    allDay: ev.allDay,
    timeZone: ev.timeZone,
    extendedPrivate: ev.extendedPrivate,
  });
  let h = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function syncBackoffMinutes(attemptsAfterFail: number): number {
  if (attemptsAfterFail <= 1) return 1;
  if (attemptsAfterFail === 2) return 5;
  if (attemptsAfterFail === 3) return 30;
  return 120;
}
