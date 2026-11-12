import { getOrder, orderFromLineRpcPayload, updateOrder, updateOrderServiceLinePrice } from "../../services/apiOrders";
import { isMissingRpcError } from "../../services/missingRpc";
import supabase from "../../services/supabase";
import type { Order, OrderService } from "../../lib/types";
import { parseQuantity } from "../../lib/quantity";
import { roundMoney } from "./orderTotals";
import { preservedOrderFieldsForLineAppend } from "./appendOrderLines";

export const UPDATE_ORDER_SERVICE_LINE_RPC = "crm_update_order_service_line";

export type OrderServiceLinePatch = {
  price?: number;
  quantity?: number;
  technicianId?: string | null;
};

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

/** Apply a patch onto one service line; other fields stay unchanged. */
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
  };
}

async function updateOrderServiceLineViaRpc(
  orderId: string,
  lineId: string,
  patch: OrderServiceLinePatch,
): Promise<Order | null> {
  const { data, error } = await supabase.rpc(UPDATE_ORDER_SERVICE_LINE_RPC, {
    p_order_id: orderId,
    p_line_id: lineId,
    p_price: patch.price ?? null,
    p_quantity: patch.quantity ?? null,
    p_technician_id: patch.technicianId === undefined ? null : patch.technicianId,
    p_set_technician: patch.technicianId !== undefined,
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
 * (write + full order in one round trip); falls back to the multi-query path when the RPC is missing.
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

  const viaRpc = await updateOrderServiceLineViaRpc(orderId, id, patch);
  if (viaRpc) return viaRpc;

  // Price / quantity only: direct line update + totals (fast). Technician changes rewrite the team → full path.
  if (patch.technicianId === undefined && (patch.price !== undefined || patch.quantity !== undefined)) {
    return updateOrderServiceLinePrice(orderId, id, { price: patch.price, quantity: patch.quantity }, workspaceId);
  }

  const fresh = await getOrder(orderId, workspaceId);
  const index = fresh.services.findIndex((line) => line.id === id);
  if (index < 0) throw new Error("Service line was not found on this order");

  const nextServices = fresh.services.map((line, i) => (i === index ? applyOrderServiceLinePatch(line, patch) : line));

  return updateOrder(
    {
      orderId,
      ...preservedOrderFieldsForLineAppend(fresh),
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
