import type { OrderEvent } from "../../services/apiOrderEvents";

export type OrderEventDescriptionKey =
  | "statusChanged"
  | "customStatusChanged"
  | "orderClosed"
  | "orderCancelled"
  | "orderReopened"
  | "serviceAdded"
  | "workAdded"
  | "serviceRemoved"
  | "workRemoved"
  | "serviceUpdated"
  | "workUpdated"
  | "materialAdded"
  | "materialRemoved"
  | "materialUpdated"
  | "materialIssued"
  | "materialReturned"
  | "generic";

export type OrderEventDescription = {
  /** i18n key under `orders.feed.events`. */
  key: OrderEventDescriptionKey;
  params: Record<string, string>;
};

const EMPTY = "—";

function payloadText(event: OrderEvent, key: string) {
  const value = event.payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function payloadNumber(event: OrderEvent, key: string) {
  const value = event.payload[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function formatAmount(value: number | null) {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  return String(value);
}

function changePair(event: OrderEvent, field: string): { from: string; to: string } | null {
  const changes = event.payload.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return null;
  const entry = (changes as Record<string, unknown>)[field];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const from = (entry as { from?: unknown }).from;
  const to = (entry as { to?: unknown }).to;
  return {
    from: from == null || from === "" ? EMPTY : String(from),
    to: to == null || to === "" ? EMPTY : String(to),
  };
}

function itemName(event: OrderEvent) {
  return payloadText(event, "item_name") ?? event.newValue ?? event.oldValue ?? EMPTY;
}

function isLabor(event: OrderEvent) {
  return payloadText(event, "kind") === "labor";
}

function lineSnapshotParams(event: OrderEvent) {
  const quantity = payloadNumber(event, "quantity");
  const price = payloadNumber(event, "price");
  return {
    item: itemName(event),
    quantity: formatAmount(quantity),
    price: formatAmount(price),
  };
}

function updatedLineParams(event: OrderEvent) {
  const qty = changePair(event, "quantity");
  const price = changePair(event, "price");
  const name = changePair(event, "name");
  return {
    item: itemName(event),
    quantity: qty ? `${qty.from} → ${qty.to}` : formatAmount(payloadNumber(event, "quantity")),
    price: price ? `${price.from} → ${price.to}` : formatAmount(payloadNumber(event, "price")),
    detail: name ? `${name.from} → ${name.to}` : "",
  };
}

/**
 * Turns a raw `order_events` row into an i18n key + params. Pure.
 * Snapshots in the payload (item_name, quantity, price, changes) win over live catalog data.
 */
export function describeOrderEvent(event: OrderEvent, statusLabel: (value: string) => string): OrderEventDescription {
  if (event.eventType === "status_changed" && event.fieldName === "custom_status_id") {
    return {
      key: "customStatusChanged",
      params: {
        from: payloadText(event, "old_name") ?? EMPTY,
        to: payloadText(event, "new_name") ?? EMPTY,
      },
    };
  }

  if (event.eventType === "status_changed") {
    const lifecycle = payloadText(event, "lifecycle");
    if (lifecycle === "close" || event.newValue === "closed") {
      return { key: "orderClosed", params: { from: event.oldValue ? statusLabel(event.oldValue) : EMPTY } };
    }
    if (lifecycle === "cancel" || event.newValue === "cancelled") {
      return { key: "orderCancelled", params: { from: event.oldValue ? statusLabel(event.oldValue) : EMPTY } };
    }
    if (lifecycle === "reopen") {
      return {
        key: "orderReopened",
        params: {
          from: event.oldValue ? statusLabel(event.oldValue) : EMPTY,
          to: event.newValue ? statusLabel(event.newValue) : EMPTY,
        },
      };
    }
    return {
      key: "statusChanged",
      params: {
        from: event.oldValue ? statusLabel(event.oldValue) : EMPTY,
        to: event.newValue ? statusLabel(event.newValue) : EMPTY,
      },
    };
  }

  if (event.eventType === "service_added") {
    return { key: isLabor(event) ? "workAdded" : "serviceAdded", params: lineSnapshotParams(event) };
  }
  if (event.eventType === "service_removed") {
    return { key: isLabor(event) ? "workRemoved" : "serviceRemoved", params: lineSnapshotParams(event) };
  }
  if (event.eventType === "service_updated") {
    return { key: isLabor(event) ? "workUpdated" : "serviceUpdated", params: updatedLineParams(event) };
  }

  if (event.eventType === "material_added") {
    return { key: "materialAdded", params: lineSnapshotParams(event) };
  }
  if (event.eventType === "material_removed") {
    return { key: "materialRemoved", params: lineSnapshotParams(event) };
  }
  if (event.eventType === "material_updated") {
    return { key: "materialUpdated", params: updatedLineParams(event) };
  }
  if (event.eventType === "material_issued") {
    return { key: "materialIssued", params: lineSnapshotParams(event) };
  }
  if (event.eventType === "material_returned") {
    return { key: "materialReturned", params: lineSnapshotParams(event) };
  }

  return {
    key: "generic",
    params: {
      type: event.eventType,
      field: event.fieldName ?? "",
      from: event.oldValue ?? EMPTY,
      to: event.newValue ?? EMPTY,
    },
  };
}

/** Pure helper: builds the payload shape written by DB line triggers (for unit tests). */
export function buildServiceLineEventPayload(input: {
  lineId: string;
  itemName: string;
  quantity: number;
  price: number;
  kind?: string | null;
  serviceId?: string | null;
  changes?: Record<string, { from: unknown; to: unknown }>;
}) {
  return {
    source: "trigger",
    line_id: input.lineId,
    item_name: input.itemName,
    quantity: input.quantity,
    price: input.price,
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.serviceId ? { service_id: input.serviceId } : {}),
    ...(input.changes ? { changes: input.changes } : {}),
  };
}

/** Pure helper: material / warehouse counter payload shape (for unit tests). */
export function buildMaterialLineEventPayload(input: {
  lineId: string;
  itemName: string;
  quantity: number;
  price: number;
  inventoryItemId?: string | null;
  changes?: Record<string, { from: unknown; to: unknown }>;
  quantityIssued?: number | null;
  quantityReturned?: number | null;
}) {
  return {
    source: "trigger",
    line_id: input.lineId,
    item_name: input.itemName,
    quantity: input.quantity,
    price: input.price,
    ...(input.inventoryItemId ? { inventory_item_id: input.inventoryItemId } : {}),
    ...(input.changes ? { changes: input.changes } : {}),
    ...(input.quantityIssued != null ? { quantity_issued: input.quantityIssued } : {}),
    ...(input.quantityReturned != null ? { quantity_returned: input.quantityReturned } : {}),
  };
}
