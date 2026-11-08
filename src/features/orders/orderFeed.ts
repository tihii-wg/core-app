import { currentLanguage } from "../../i18n";
import { formatQuantity } from "../../lib/quantity";
import type { OrderEvent } from "../../services/apiOrderEvents";

export type OrderEventDescriptionKey =
  | "statusChanged"
  | "customStatusChanged"
  | "orderClosed"
  | "orderCancelled"
  | "orderReopened"
  | "orderCreated"
  | "orderFieldChanged"
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
  | "paymentPartial"
  | "paymentFull"
  | "paymentBalance"
  | "paymentRefund"
  | "paymentVoid"
  | "warrantyActivated"
  | "warrantyUpdated"
  | "warrantyClaimCreated"
  | "warrantyClaimUpdated"
  | "generic";

export type OrderEventCategory =
  | "lifecycle"
  | "status"
  | "payment"
  | "refund"
  | "service"
  | "inventory"
  | "field"
  | "warranty"
  | "other";

export type OrderEventDescription = {
  /** i18n key under `orders.feed.events`. */
  key: OrderEventDescriptionKey;
  params: Record<string, string>;
};

export type PaymentSettlement = "partial" | "full" | "balance" | "refund" | "void";

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

function formatQty(value: number | null) {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  return formatQuantity(value, currentLanguage());
}

function changePair(event: OrderEvent, field: string, format: "qty" | "text" = "text"): { from: string; to: string } | null {
  const changes = event.payload.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return null;
  const entry = (changes as Record<string, unknown>)[field];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const from = (entry as { from?: unknown }).from;
  const to = (entry as { to?: unknown }).to;
  const formatValue = (raw: unknown) => {
    if (raw == null || raw === "") return EMPTY;
    if (format === "qty") {
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? formatQuantity(n, currentLanguage()) : String(raw);
    }
    return String(raw);
  };
  return {
    from: formatValue(from),
    to: formatValue(to),
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
    quantity: formatQty(quantity),
    price: formatAmount(price),
  };
}

function updatedLineParams(event: OrderEvent) {
  const qty = changePair(event, "quantity", "qty");
  const price = changePair(event, "price");
  const name = changePair(event, "name");
  return {
    item: itemName(event),
    quantity: qty ? `${qty.from} → ${qty.to}` : formatQty(payloadNumber(event, "quantity")),
    price: price ? `${price.from} → ${price.to}` : formatAmount(payloadNumber(event, "price")),
    detail: name ? `${name.from} → ${name.to}` : "",
  };
}

function methodLabel(method: string | null) {
  if (!method) return EMPTY;
  return method.replace(/_/g, "-");
}

function fieldChangeSummary(event: OrderEvent): string {
  const changes = event.payload.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return EMPTY;
  const keys = Object.keys(changes as Record<string, unknown>);
  if (keys.length === 0) return EMPTY;
  const labels: Record<string, string> = {
    client_id: "client",
    vehicle_id: "vehicle",
    employee_id: "technician",
    manager_id: "manager",
    device: "device",
    description: "description",
    vin: "VIN",
    car_number: "plate",
    malfunction: "complaint",
    manager_notes: "manager notes",
    technician_notes: "technician notes",
    conclusion: "conclusion",
    vehicle_mileage_snapshot: "mileage",
  };
  return keys.map((key) => labels[key] ?? key).join(", ");
}

/**
 * Pure settlement classifier used by tests and UI. Mirrors the SQL trigger rules:
 * - refund / void kinds stay distinct
 * - remaining ≈ 0 and prior net > 0 → balance
 * - remaining ≈ 0 and no prior net → full
 * - otherwise partial
 */
export function classifyPaymentSettlement(input: {
  kind: string;
  remainingAfter: number;
  priorNetPaid: number;
}): PaymentSettlement {
  if (input.kind === "refund") return "refund";
  if (input.kind === "void") return "void";
  if (input.remainingAfter <= 0.005) {
    return input.priorNetPaid > 0.005 ? "balance" : "full";
  }
  return "partial";
}

/** Pure payload builder for payment timeline events (mirrors DB trigger shape). */
export function buildPaymentTimelinePayload(input: {
  paymentId: string;
  kind: "payment" | "refund" | "void";
  amount: number;
  currencyCode: string;
  paymentMethod: string;
  settlement: PaymentSettlement;
  remainingAfter: number;
  netPaidAfter: number;
  orderTotal: number;
  relatedPaymentId?: string | null;
  invoiceId?: string | null;
  note?: string | null;
  paidAt?: string | null;
}) {
  return {
    source: "trigger",
    payment_id: input.paymentId,
    kind: input.kind,
    amount: input.amount,
    signed_amount: input.kind === "payment" ? input.amount : -input.amount,
    currency_code: input.currencyCode,
    payment_method: input.paymentMethod,
    settlement: input.settlement,
    remaining_after: input.remainingAfter,
    net_paid_after: input.netPaidAfter,
    order_total: input.orderTotal,
    ...(input.relatedPaymentId ? { related_payment_id: input.relatedPaymentId } : {}),
    ...(input.invoiceId ? { invoice_id: input.invoiceId } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.paidAt ? { paid_at: input.paidAt } : {}),
  };
}

/**
 * Turns a raw `order_events` row into an i18n key + params. Pure.
 * Snapshots in the payload (item_name, quantity, price, changes) win over live catalog data.
 */
function statusChangedNames(event: OrderEvent, statusLabel: (value: string) => string) {
  // Prefer frozen custom-status names; never surface raw definition UUIDs.
  const fromCustom = payloadText(event, "old_name");
  const toCustom = payloadText(event, "new_name");
  if (event.fieldName === "custom_status_id" || fromCustom || toCustom) {
    return {
      from: fromCustom ?? EMPTY,
      to: toCustom ?? EMPTY,
    };
  }
  return {
    from: event.oldValue ? statusLabel(event.oldValue) : EMPTY,
    to: event.newValue ? statusLabel(event.newValue) : EMPTY,
  };
}

function paymentParams(event: OrderEvent) {
  const amount = payloadNumber(event, "amount");
  const remaining = payloadNumber(event, "remaining_after");
  const currency = payloadText(event, "currency_code") ?? "";
  const method = methodLabel(payloadText(event, "payment_method"));
  return {
    amount: formatAmount(amount),
    currency,
    method,
    remaining: formatAmount(remaining),
  };
}

export function describeOrderEvent(event: OrderEvent, statusLabel: (value: string) => string): OrderEventDescription {
  if (event.eventType === "order_created") {
    return {
      key: "orderCreated",
      params: { number: payloadText(event, "order_number") ?? event.newValue ?? EMPTY },
    };
  }

  if (event.eventType === "order_field_changed") {
    return { key: "orderFieldChanged", params: { fields: fieldChangeSummary(event) } };
  }

  if (event.eventType === "status_changed") {
    const lifecycle = payloadText(event, "lifecycle");
    const names = statusChangedNames(event, statusLabel);

    // Legacy custom_status_id rows and system status rows both render as one "Status changed" event.
    // Close/cancel/reopen keep dedicated titles so lifecycle remains visible.
    if (lifecycle === "close" || event.newValue === "closed") {
      return { key: "orderClosed", params: { from: names.from } };
    }
    if (lifecycle === "cancel" || event.newValue === "cancelled") {
      return { key: "orderCancelled", params: { from: names.from } };
    }
    if (lifecycle === "reopen") {
      return { key: "orderReopened", params: names };
    }
    return { key: "statusChanged", params: names };
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

  if (event.eventType === "payment_recorded") {
    const settlement = payloadText(event, "settlement") ?? "partial";
    const params = paymentParams(event);
    if (settlement === "full") return { key: "paymentFull", params };
    if (settlement === "balance") return { key: "paymentBalance", params };
    return { key: "paymentPartial", params };
  }
  if (event.eventType === "payment_refunded") {
    return { key: "paymentRefund", params: paymentParams(event) };
  }
  if (event.eventType === "payment_voided") {
    return { key: "paymentVoid", params: paymentParams(event) };
  }

  if (event.eventType === "warranty_activated") {
    return { key: "warrantyActivated", params: { item: itemName(event) } };
  }
  if (event.eventType === "warranty_updated") {
    return { key: "warrantyUpdated", params: { item: itemName(event) } };
  }
  if (event.eventType === "warranty_claim_created") {
    return {
      key: "warrantyClaimCreated",
      params: { status: payloadText(event, "validity_status") ?? event.newValue ?? EMPTY },
    };
  }
  if (event.eventType === "warranty_claim_updated") {
    const status = changePair(event, "validity_status");
    return {
      key: "warrantyClaimUpdated",
      params: {
        from: status?.from ?? event.oldValue ?? EMPTY,
        to: status?.to ?? event.newValue ?? payloadText(event, "validity_status") ?? EMPTY,
      },
    };
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

/** Visual category for timeline markers. */
export function orderEventCategory(event: OrderEvent): OrderEventCategory {
  switch (event.eventType) {
    case "order_created":
    case "order_field_changed":
      return event.eventType === "order_created" ? "lifecycle" : "field";
    case "status_changed": {
      const lifecycle = payloadText(event, "lifecycle");
      if (lifecycle === "close" || lifecycle === "cancel" || lifecycle === "reopen") return "lifecycle";
      if (event.newValue === "closed" || event.newValue === "cancelled") return "lifecycle";
      return "status";
    }
    case "payment_recorded":
      return "payment";
    case "payment_refunded":
    case "payment_voided":
      return "refund";
    case "service_added":
    case "service_removed":
    case "service_updated":
      return "service";
    case "material_added":
    case "material_removed":
    case "material_updated":
    case "material_issued":
    case "material_returned":
      return "inventory";
    case "warranty_activated":
    case "warranty_updated":
    case "warranty_claim_created":
    case "warranty_claim_updated":
      return "warranty";
    default:
      return "other";
  }
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
