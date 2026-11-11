import type { Order } from "../../lib/types";

/** Order fields needed to derive client assets (devices / sites). Works with full and search-shaped orders. */
export type ClientAssetOrder = Pick<Order, "id" | "createdAt"> &
  Partial<Pick<Order, "device" | "deviceSerial" | "deviceImei" | "siteAddress" | "productDimensions">>;

export type ClientDeviceAsset = {
  /** Stable key: normalized name + serial + IMEI. */
  key: string;
  name: string;
  serial: string;
  imei: string;
  /** Latest order date (yyyy-mm-dd) among orders for this device, "" when unknown. */
  lastOrderDate: string;
  orderCount: number;
  orderIds: string[];
};

export type ClientSiteAsset = {
  key: string;
  /** Site address when present, otherwise product dimensions / product notes. */
  label: string;
  /** Extra line: dimensions when the label is an address. */
  details: string;
  lastOrderDate: string;
  orderCount: number;
  orderIds: string[];
};

/** Filter applied on the Orders tab after tapping an asset. */
export type ClientAssetFilter = {
  kind: "device" | "site";
  key: string;
  label: string;
  orderIds: string[];
};

export function normalizeAssetText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function orderDay(order: Pick<Order, "createdAt">): string {
  return (order.createdAt ?? "").slice(0, 10);
}

function newer(a: string, b: string): string {
  return b.localeCompare(a) > 0 ? b : a;
}

/** Newest first; ties broken by label for a stable order. */
function byLastOrderThenLabel<T extends { lastOrderDate: string }>(label: (item: T) => string) {
  return (a: T, b: T) => b.lastOrderDate.localeCompare(a.lastOrderDate) || label(a).localeCompare(label(b));
}

export function deviceAssetKey(name: string, serial: string, imei: string): string {
  return [normalizeAssetText(name), normalizeAssetText(serial), normalizeAssetText(imei)].join("|");
}

/** Distinct devices from a client's orders (no DB table — derived on the fly). */
export function deriveClientDevices(orders: ClientAssetOrder[]): ClientDeviceAsset[] {
  const map = new Map<string, ClientDeviceAsset>();
  for (const order of orders) {
    const name = clean(order.device);
    const serial = clean(order.deviceSerial);
    const imei = clean(order.deviceImei);
    if (!name && !serial && !imei) continue;

    const key = deviceAssetKey(name, serial, imei);
    const day = orderDay(order);
    const existing = map.get(key);
    if (existing) {
      existing.orderCount += 1;
      existing.orderIds.push(order.id);
      existing.lastOrderDate = newer(existing.lastOrderDate, day);
    } else {
      map.set(key, { key, name, serial, imei, lastOrderDate: day, orderCount: 1, orderIds: [order.id] });
    }
  }
  return [...map.values()].sort(byLastOrderThenLabel((item: ClientDeviceAsset) => item.name || item.serial || item.imei));
}

/**
 * Distinct objects/sites from a client's orders. Furniture / field services keep the
 * object or product in `device` («Объект / изделие» / «Работа / место») and the place in
 * `siteAddress`: an object is address + product; either one alone is enough.
 * Falls back to `productDimensions` when both are empty. Orders with nothing are skipped.
 */
export function deriveClientSites(orders: ClientAssetOrder[]): ClientSiteAsset[] {
  const map = new Map<string, ClientSiteAsset>();
  for (const order of orders) {
    const address = clean(order.siteAddress);
    const product = clean(order.device);
    const dimensions = clean(order.productDimensions);
    const label = [address, product].filter(Boolean).join(" · ") || dimensions;
    if (!label) continue;

    const key = `${address || product ? "site" : "dimensions"}:${normalizeAssetText(label)}`;
    const day = orderDay(order);
    const details = address || product ? dimensions : "";
    const existing = map.get(key);
    if (existing) {
      existing.orderCount += 1;
      existing.orderIds.push(order.id);
      if (day.localeCompare(existing.lastOrderDate) >= 0) {
        existing.lastOrderDate = day;
        if (details) existing.details = details;
      }
    } else {
      map.set(key, { key, label, details, lastOrderDate: day, orderCount: 1, orderIds: [order.id] });
    }
  }
  return [...map.values()].sort(byLastOrderThenLabel((item: ClientSiteAsset) => item.label));
}

export function deviceAssetFilter(device: ClientDeviceAsset): ClientAssetFilter {
  return {
    kind: "device",
    key: device.key,
    label: [device.name, device.serial].filter(Boolean).join(" · ") || device.imei,
    orderIds: device.orderIds,
  };
}

export function siteAssetFilter(site: ClientSiteAsset): ClientAssetFilter {
  return { kind: "site", key: site.key, label: site.label, orderIds: site.orderIds };
}

/** Keep only items whose id is in the asset filter (no filter → unchanged). */
export function applyClientAssetFilter<T extends { id: string }>(items: T[], filter: ClientAssetFilter | null): T[] {
  if (!filter) return items;
  const allowed = new Set(filter.orderIds);
  return items.filter((item) => allowed.has(item.id));
}
