import type { Order, OrderStatus, Vehicle } from "../../lib/types";
import { orderPaymentBalance } from "../finance/paymentCalculations";
import type { LedgerPayment } from "../finance/paymentTypes";
import type { IndustryOrderFieldBlocks } from "../industries/industryProfile";

/** Cyrillic ↔ Latin look-alikes used on MD/RU plates. */
const PLATE_LOOKALIKES: Record<string, string> = {
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  Х: "X",
  У: "Y",
  A: "A",
  B: "B",
  E: "E",
  K: "K",
  M: "M",
  H: "H",
  O: "O",
  P: "P",
  C: "C",
  T: "T",
  X: "X",
  Y: "Y",
};

/** Normalize for plate/VIN matching: upper, strip spaces/dashes, map look-alikes. */
export function normalizePlateVin(value: string): string {
  return Array.from(value.toUpperCase())
    .map((ch) => {
      if (ch === " " || ch === "-" || ch === "–" || ch === "—") return "";
      return PLATE_LOOKALIKES[ch] ?? ch;
    })
    .join("");
}

function fold(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function includesFold(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return fold(haystack).includes(needle);
}

function includesPlate(haystack: string, needleRaw: string): boolean {
  const needle = normalizePlateVin(needleRaw);
  if (!needle) return true;
  return normalizePlateVin(haystack).includes(needle);
}

function formatDdMmYyyy(isoLike: string): string {
  const day = isoLike.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const [y, m, d] = day.split("-");
  return `${d}.${m}.${y}`;
}

export type ClientSearchableOrder = Pick<
  Order,
  | "id"
  | "orderNumber"
  | "status"
  | "customStatus"
  | "device"
  | "carNumber"
  | "vin"
  | "deviceSerial"
  | "deviceImei"
  | "siteAddress"
  | "productDimensions"
  | "description"
  | "assignedEmployeeName"
  | "totalPrice"
  | "createdAt"
  | "deadline"
  | "isPaid"
  | "services"
  | "materials"
  | "vehicleId"
>;

export type ClientSearchVehicle = Pick<Vehicle, "id" | "make" | "model" | "year" | "licensePlate" | "vin">;

export type ClientSearchOptions = {
  query: string;
  orders: ClientSearchableOrder[];
  vehicles: ClientSearchVehicle[];
  payments?: LedgerPayment[];
  /** Status labels keyed by OrderStatus (already translated). */
  statusLabels?: Partial<Record<OrderStatus, string>>;
  /** Payment labels: unpaid / partial / paid (already translated). */
  paymentLabels?: { unpaid: string; partial: string; paid: string };
  industryBlocks?: IndustryOrderFieldBlocks;
};

export type ClientSearchResult = {
  orderIds: string[];
  vehicleIds: string[];
  /** Lowercased query used for highlighting. */
  normalizedQuery: string;
};

function paymentStatusLabel(
  order: ClientSearchableOrder,
  payments: LedgerPayment[],
  labels: { unpaid: string; partial: string; paid: string },
): string {
  const balance = orderPaymentBalance(order, payments);
  if (balance.status === "paid") return labels.paid;
  if (balance.status === "partial") return labels.partial;
  return labels.unpaid;
}

function orderMatches(
  order: ClientSearchableOrder,
  needle: string,
  raw: string,
  options: ClientSearchOptions,
): boolean {
  const blocks = options.industryBlocks;
  const statusLabel =
    options.statusLabels?.[order.status] ??
    order.customStatus?.name ??
    order.status;

  const haystacks: string[] = [
    order.orderNumber,
    statusLabel,
    order.device ?? "",
    order.description ?? "",
    order.assignedEmployeeName ?? "",
    String(order.totalPrice ?? ""),
    order.createdAt ?? "",
    formatDdMmYyyy(order.createdAt ?? ""),
    order.deadline ?? "",
    formatDdMmYyyy(order.deadline ?? ""),
  ];

  if (includesPlate(order.carNumber ?? "", raw) || includesPlate(order.vin ?? "", raw)) return true;

  // Vehicle linked to the order (make/model/plate/VIN from the client's garage).
  const linked = order.vehicleId ? options.vehicles.find((vehicle) => vehicle.id === order.vehicleId) : undefined;
  if (linked && vehicleMatches(linked, needle, raw)) return true;

  if (blocks?.deviceSerial) haystacks.push(order.deviceSerial ?? "");
  if (blocks?.deviceImei) haystacks.push(order.deviceImei ?? "");
  if (blocks?.siteAddress) haystacks.push(order.siteAddress ?? "");
  if (blocks?.productDimensions) haystacks.push(order.productDimensions ?? "");

  for (const line of order.services ?? []) {
    haystacks.push(line.serviceName ?? "");
  }
  for (const line of order.materials ?? []) {
    haystacks.push(line.itemName ?? "");
  }

  const payLabels = options.paymentLabels ?? { unpaid: "unpaid", partial: "partial", paid: "paid" };
  const paymentLabel = paymentStatusLabel(order, options.payments ?? [], payLabels);
  // Exact / prefix match so "оплачен" does not hit "не оплачен".
  if (paymentStatusMatches(paymentLabel, needle)) return true;

  return haystacks.some((part) => includesFold(part, needle));
}

function paymentStatusMatches(label: string, needle: string): boolean {
  if (!needle) return true;
  const folded = fold(label);
  // Prefix/exact only — avoids "оплачен"/"paid" matching "не оплачен"/"unpaid".
  return folded === needle || folded.startsWith(needle);
}

function vehicleMatches(vehicle: ClientSearchVehicle, needle: string, raw: string): boolean {
  if (includesPlate(vehicle.licensePlate ?? "", raw) || includesPlate(vehicle.vin ?? "", raw)) return true;
  return [vehicle.make, vehicle.model, String(vehicle.year ?? "")].some((part) => includesFold(part ?? "", needle));
}

/** Filter a client's orders and vehicles by a free-text query. Pure. */
export function filterClientCardSearch(options: ClientSearchOptions): ClientSearchResult {
  const raw = options.query.trim();
  const needle = fold(raw);
  if (!needle) {
    return {
      orderIds: options.orders.map((o) => o.id),
      vehicleIds: options.vehicles.map((v) => v.id),
      normalizedQuery: "",
    };
  }

  const vehiclesById = new Map(options.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const matchedVehicleIds = new Set(
    options.vehicles.filter((vehicle) => vehicleMatches(vehicle, needle, raw)).map((v) => v.id),
  );

  const orderIds = options.orders
    .filter((order) => {
      // A matched vehicle brings all of its orders (even when the order has no plate snapshot).
      if (order.vehicleId && matchedVehicleIds.has(order.vehicleId)) return true;
      if (orderMatches(order, needle, raw, options)) return true;
      if (orderPaymentsMatch(order, needle, options.payments ?? [])) return true;
      return false;
    })
    .map((o) => o.id);

  // A matched order also reveals the vehicle it was done on.
  for (const order of options.orders) {
    if (order.vehicleId && vehiclesById.has(order.vehicleId) && orderIds.includes(order.id)) {
      matchedVehicleIds.add(order.vehicleId);
    }
  }

  return {
    orderIds,
    vehicleIds: options.vehicles.filter((v) => matchedVehicleIds.has(v.id)).map((v) => v.id),
    normalizedQuery: needle,
  };
}

/** Payments linked to the order: amount (as typed: 1500 / 1500.5 / 1 500), date dd.mm.yyyy, note. */
function orderPaymentsMatch(order: ClientSearchableOrder, needle: string, payments: LedgerPayment[]): boolean {
  const compactNeedle = needle.replace(/[\s\u00a0]/g, "").replace(",", ".");
  for (const row of payments) {
    if (row.orderId !== order.id) continue;
    const amount = Number(row.amount);
    if (Number.isFinite(amount) && /^\d+(\.\d+)?$/.test(compactNeedle)) {
      const asText = String(amount);
      if (asText === compactNeedle || asText.startsWith(compactNeedle) || amount.toFixed(2) === compactNeedle) return true;
    }
    if (includesFold(formatDdMmYyyy(row.paidAt ?? ""), needle) || includesFold(row.paidAt ?? "", needle)) return true;
    if (row.note && includesFold(row.note, needle)) return true;
  }
  return false;
}

/** Wrap case-insensitive matches in <mark> spans for display (returns HTML-safe text with mark tags). */
export function highlightMatch(text: string, normalizedQuery: string): string {
  if (!normalizedQuery || !text) return text;
  const source = String(text);
  const lower = source.toLowerCase();
  const parts: string[] = [];
  let cursor = 0;
  let idx = lower.indexOf(normalizedQuery, cursor);
  while (idx !== -1) {
    parts.push(escapeHtml(source.slice(cursor, idx)));
    parts.push(`<mark>${escapeHtml(source.slice(idx, idx + normalizedQuery.length))}</mark>`);
    cursor = idx + normalizedQuery.length;
    idx = lower.indexOf(normalizedQuery, cursor);
  }
  parts.push(escapeHtml(source.slice(cursor)));
  return parts.join("");
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
