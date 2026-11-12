import { getOrder, orderFromLineRpcPayload, updateOrder, updateOrderServiceLinePrice } from "../../services/apiOrders";
import { isMissingRpcError } from "../../services/missingRpc";
import supabase from "../../services/supabase";
import type { Order, OrderService, OrderServiceKind } from "../../lib/types";
import { parseQuantity } from "../../lib/quantity";
import { isLineDiscountType, roundMoney } from "./orderTotals";
import { preservedOrderFieldsForLineAppend } from "./appendOrderLines";

export const UPDATE_ORDER_SERVICE_LINE_RPC = "crm_update_order_service_line";

export type OrderServiceLinePatch = {
  price?: number;
  quantity?: number;
  technicianId?: string | null;
  kind?: OrderServiceKind | null;
  warrantyMonths?: number | null;
  warrantyDays?: number | null;
  warrantyKm?: number | null;
  discountType?: "percent" | "amount" | null;
  discountValue?: number | null;
};

function patchTouchesExtendedFields(patch: OrderServiceLinePatch): boolean {
  return (
    patch.kind !== undefined ||
    patch.warrantyMonths !== undefined ||
    patch.warrantyDays !== undefined ||
    patch.warrantyKm !== undefined ||
    patch.discountType !== undefined ||
    patch.discountValue !== undefined
  );
}

function patchTouchesWarranty(patch: OrderServiceLinePatch): boolean {
  return patch.warrantyMonths !== undefined || patch.warrantyDays !== undefined || patch.warrantyKm !== undefined;
}

function patchTouchesDiscount(patch: OrderServiceLinePatch): boolean {
  return patch.discountType !== undefined || patch.discountValue !== undefined;
}

/**
 * Parse a typed unit price for an order service line.
 * Accepts "," and "." as decimal separators; allows 0; rejects negatives and non-numbers.
 */
export function parseOrderServiceLinePrice(input: unknown): number | "invalid" {
  if (input === "" || input == null) return "invalid";
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return "invalid";
    return roundMoney(input);
  }
  const normalized = String(input)
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return "invalid";
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return "invalid";
  return roundMoney(parsed);
}

/** Apply a patch onto one service line; other fields stay unchanged. `null` clears optional fields. */
export function applyOrderServiceLinePatch(line: OrderService, patch: OrderServiceLinePatch): OrderService {
  return {
    ...line,
    ...(patch.price !== undefined ? { price: roundMoney(patch.price) } : {}),
    ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
    ...(patch.technicianId !== undefined
      ? {
          technicianId: patch.technicianId?.trim() ? patch.technicianId.trim() : null,
          ...(patch.technicianId?.trim() ? {} : { technicianName: "" }),
        }
      : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.warrantyMonths !== undefined ? { warrantyMonths: patch.warrantyMonths } : {}),
    ...(patch.warrantyDays !== undefined ? { warrantyDays: patch.warrantyDays } : {}),
    ...(patch.warrantyKm !== undefined ? { warrantyKm: patch.warrantyKm } : {}),
    ...(patch.discountType !== undefined ? { discountType: patch.discountType } : {}),
    ...(patch.discountValue !== undefined ? { discountValue: patch.discountValue } : {}),
  };
}

/** Diff a draft line against the saved line into a sparse patch (absent = unchanged). */
export function diffOrderServiceLinePatch(original: OrderService, draft: OrderService): OrderServiceLinePatch {
  const patch: OrderServiceLinePatch = {};
  if (roundMoney(Number(draft.price) || 0) !== roundMoney(Number(original.price) || 0)) {
    patch.price = roundMoney(Number(draft.price) || 0);
  }
  if (Number(draft.quantity) !== Number(original.quantity)) {
    patch.quantity = Number(draft.quantity);
  }
  const nextTech = draft.technicianId?.trim() ? draft.technicianId.trim() : null;
  const prevTech = original.technicianId?.trim() ? original.technicianId.trim() : null;
  if (nextTech !== prevTech) patch.technicianId = nextTech;

  const nextKind = draft.kind ?? null;
  const prevKind = original.kind ?? null;
  if (nextKind !== prevKind) patch.kind = nextKind;

  const nextMonths = draft.warrantyMonths ?? null;
  const prevMonths = original.warrantyMonths ?? null;
  const nextDays = draft.warrantyDays ?? null;
  const prevDays = original.warrantyDays ?? null;
  const nextKm = draft.warrantyKm ?? null;
  const prevKm = original.warrantyKm ?? null;
  if (nextMonths !== prevMonths || nextDays !== prevDays || nextKm !== prevKm) {
    patch.warrantyMonths = nextMonths;
    patch.warrantyDays = nextDays;
    patch.warrantyKm = nextKm;
  }

  const nextDiscType = draft.discountType ?? null;
  const prevDiscType = original.discountType ?? null;
  const nextDiscValue = draft.discountValue ?? null;
  const prevDiscValue = original.discountValue ?? null;
  if (nextDiscType !== prevDiscType || nextDiscValue !== prevDiscValue) {
    patch.discountType = nextDiscType;
    patch.discountValue = nextDiscValue;
  }

  return patch;
}

export function orderServiceLinePatchIsEmpty(patch: OrderServiceLinePatch): boolean {
  return Object.keys(patch).length === 0;
}

async function updateOrderServiceLineViaRpc(
  orderId: string,
  lineId: string,
  patch: OrderServiceLinePatch,
  merged: OrderService,
): Promise<Order | null> {
  const setWarranty = patchTouchesWarranty(patch);
  const setKind = patch.kind !== undefined;
  const setDiscount = patchTouchesDiscount(patch);

  const { data, error } = await supabase.rpc(UPDATE_ORDER_SERVICE_LINE_RPC, {
    p_order_id: orderId,
    p_line_id: lineId,
    p_price: patch.price ?? null,
    p_quantity: patch.quantity ?? null,
    p_technician_id: patch.technicianId === undefined ? null : patch.technicianId,
    p_set_technician: patch.technicianId !== undefined,
    p_warranty_months: setWarranty ? (merged.warrantyMonths ?? null) : null,
    p_warranty_days: setWarranty ? (merged.warrantyDays ?? null) : null,
    p_warranty_km: setWarranty ? (merged.warrantyKm ?? null) : null,
    p_set_warranty: setWarranty,
    p_kind: setKind ? (merged.kind ?? null) : null,
    p_set_kind: setKind,
    p_discount_type: setDiscount ? (merged.discountType ?? null) : null,
    p_discount_value: setDiscount ? (merged.discountValue ?? null) : null,
    p_set_discount: setDiscount,
  });
  if (error) {
    if (isMissingRpcError(error, UPDATE_ORDER_SERVICE_LINE_RPC)) return null;
    throw new Error(error.message);
  }
  const order = orderFromLineRpcPayload(data);
  if (!order) throw new Error("Invalid order payload");
  return order;
}

/**
 * Patches ONE service line by `order_services.id`. Prefers `crm_update_order_service_line`
 * (write + full order in one round trip); falls back to the multi-query path when the RPC is missing
 * or the connected DB still has the older signature (extra named args → PGRST202).
 */
export async function updateOrderServiceLine(
  orderId: string,
  lineId: string,
  patch: OrderServiceLinePatch,
  workspaceId: string | undefined,
): Promise<Order> {
  const id = lineId.trim();
  if (!id) throw new Error("Service line id is required");

  if (patch.price !== undefined) {
    const price = parseOrderServiceLinePrice(patch.price);
    if (price === "invalid") throw new Error("Invalid price");
    patch = { ...patch, price };
  }
  if (patch.quantity !== undefined) {
    const quantity = parseQuantity(patch.quantity);
    if (typeof quantity !== "number") throw new Error("Invalid quantity");
    patch = { ...patch, quantity };
  }
  if (patch.discountType !== undefined && patch.discountType != null && !isLineDiscountType(patch.discountType)) {
    throw new Error("Invalid discount type");
  }

  // Prefetch when we need merged warranty/kind/discount values for the RPC (or the full-order fallback).
  let baseOrder: Order | null = null;
  let mergedForRpc: OrderService = { id } as OrderService;
  if (patchTouchesExtendedFields(patch) || patch.technicianId !== undefined) {
    baseOrder = await getOrder(orderId, workspaceId);
    const current = baseOrder.services.find((line) => line.id === id);
    if (!current) throw new Error("Service line was not found on this order");
    mergedForRpc = applyOrderServiceLinePatch(current, patch);
  }

  const viaRpc = await updateOrderServiceLineViaRpc(orderId, id, patch, mergedForRpc);
  if (viaRpc) return viaRpc;

  // Price / quantity only: direct line update + totals (fast). Extended / technician → full updateOrder.
  if (
    !patchTouchesExtendedFields(patch) &&
    patch.technicianId === undefined &&
    (patch.price !== undefined || patch.quantity !== undefined)
  ) {
    return updateOrderServiceLinePrice(orderId, id, { price: patch.price, quantity: patch.quantity }, workspaceId);
  }

  const base = baseOrder ?? (await getOrder(orderId, workspaceId));
  const index = base.services.findIndex((line) => line.id === id);
  if (index < 0) throw new Error("Service line was not found on this order");

  const nextServices = base.services.map((line, i) =>
    i === index ? applyOrderServiceLinePatch(line, patch) : line,
  );

  return updateOrder(
    {
      orderId,
      ...preservedOrderFieldsForLineAppend(base),
      services: nextServices,
    },
    workspaceId,
  );
}

/** Test helper: build the services array that would be sent for a single-line patch. */
export function patchServicesForLineUpdate(
  services: readonly OrderService[],
  lineId: string,
  patch: OrderServiceLinePatch,
): OrderService[] {
  return services.map((line) => (line.id === lineId ? applyOrderServiceLinePatch(line, patch) : line));
}
