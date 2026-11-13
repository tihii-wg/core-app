import {
  appendOrderCatalogServiceLine,
  getOrder,
  orderFromLineRpcPayload,
  updateOrder,
} from "../../services/apiOrders";
import { isMissingRpcError } from "../../services/missingRpc";
import supabase from "../../services/supabase";
import type { Order, OrderMaterial, OrderService, UpdateOrderDetails } from "../../lib/types";
import { isCatalogOrderMaterial } from "../inventory/orderMaterialLine";
import { parseInsufficientStockRpcMessage } from "./catalogMaterialStockLimit";
import i18n from "../../i18n";

export const ADD_ORDER_SERVICE_LINE_RPC = "crm_add_order_service_line";
export const ADD_AND_ISSUE_ORDER_CATALOG_MATERIAL_RPC = "crm_add_and_issue_order_catalog_material";

/**
 * `updateOrder` always rewrites the order row (device, description, assignee, deadline, ...) and the team, so a
 * lines-only append / single-line patch must echo the freshly loaded values back — same shape the panel's
 * assignee / team handlers send. Industry fields and mileage snapshots are omitted on purpose: omitted means
 * "leave the columns untouched".
 */
export function preservedOrderFieldsForLineAppend(
  fresh: Order,
): Omit<UpdateOrderDetails, "orderId" | "services" | "materials"> {
  return {
    vehicleId: fresh.vehicleId ?? undefined,
    device: fresh.device,
    carNumber: fresh.carNumber,
    vin: fresh.vin,
    description: fresh.description,
    assignedEmployeeId: fresh.assignedEmployeeId,
    team: (fresh.team ?? []).map((member) => ({ employeeId: member.employeeId, role: member.role })),
    deadline: fresh.deadline,
  };
}

async function addOrderServiceLineViaRpc(orderId: string, draft: OrderService): Promise<Order | null> {
  const serviceId = draft.serviceId?.trim();
  if (!serviceId) return null;
  const { data, error } = await supabase.rpc(ADD_ORDER_SERVICE_LINE_RPC, {
    p_order_id: orderId,
    p_service_id: serviceId,
    p_price: Number(draft.price) || 0,
    p_quantity: Number(draft.quantity) || 1,
    p_technician_id: draft.technicianId?.trim() || null,
    p_warranty_months: draft.warrantyMonths ?? null,
    p_warranty_days: draft.warrantyDays ?? null,
    p_warranty_km: draft.warrantyKm ?? null,
    p_kind: draft.kind ?? null,
  });
  if (error) {
    if (isMissingRpcError(error, ADD_ORDER_SERVICE_LINE_RPC)) return null;
    throw new Error(error.message);
  }
  const order = orderFromLineRpcPayload(data);
  if (!order) throw new Error("Invalid order payload");
  return order;
}

function mapAddMaterialRpcError(error: { message?: string } | null): Error | null {
  if (!error?.message) return null;
  const message = error.message;
  if (/closed_order_immutable|cancelled_order_immutable/i.test(message)) {
    return new Error(i18n.t("orders.lifecycle.errors.closedOrderImmutable"));
  }
  if (/warehouse_permission/i.test(message)) {
    return new Error(i18n.t("orders.errors.warehousePermission"));
  }
  if (/warehouse_required/i.test(message)) {
    return new Error(i18n.t("orders.warehouse.warehouseRequired"));
  }
  if (/order_material:insufficient_stock|insufficient_warehouse_stock|insufficient_batch_stock/i.test(message)) {
    const parsed = parseInsufficientStockRpcMessage(message);
    if (parsed?.available != null) {
      return new Error(
        i18n.t("orders.form.onlyNAvailableOnWarehouse", {
          available: parsed.available,
          warehouse: "",
        }),
      );
    }
    return new Error(i18n.t("orders.errors.insufficientWarehouseStock"));
  }
  return null;
}

async function addCatalogMaterialViaRpc(orderId: string, draft: OrderMaterial): Promise<Order | null> {
  const itemId = draft.inventoryItemId?.trim();
  const warehouseId = draft.warehouseId?.trim();
  if (!itemId || !warehouseId) return null;
  const { data, error } = await supabase.rpc(ADD_AND_ISSUE_ORDER_CATALOG_MATERIAL_RPC, {
    p_order_id: orderId,
    p_warehouse_id: warehouseId,
    p_inventory_item_id: itemId,
    p_quantity: Number(draft.quantity) || 1,
    p_price: draft.price ?? null,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) {
    if (isMissingRpcError(error, ADD_AND_ISSUE_ORDER_CATALOG_MATERIAL_RPC)) return null;
    throw mapAddMaterialRpcError(error) ?? new Error(error.message);
  }
  const order = orderFromLineRpcPayload(data);
  if (!order) throw new Error("Invalid order payload");
  return order;
}

/**
 * Appends new service lines to the order's CURRENT lines (re-read right before saving, so lines another user
 * added meanwhile are not dropped). Existing lines keep their ids / stored fields; the new ones have no id, so
 * `updateOrder` creates them, stamps the client's service discount on them only, syncs warranties and totals.
 * Material lines are omitted → untouched.
 */
export async function appendOrderServiceLines(
  orderId: string,
  drafts: readonly OrderService[],
  workspaceId: string | undefined,
): Promise<Order> {
  // One catalog service (the order-card search): one RPC when available.
  if (drafts.length === 1 && drafts[0]?.serviceId?.trim()) {
    const viaRpc = await addOrderServiceLineViaRpc(orderId, drafts[0]);
    if (viaRpc) return viaRpc;
    const quick = await appendOrderCatalogServiceLine(orderId, drafts[0], workspaceId);
    if (quick) return quick;
    // Already on the order → fall through to the full path, which keeps the existing line and changes nothing.
  }
  const fresh = await getOrder(orderId, workspaceId);
  return updateOrder(
    {
      orderId,
      ...preservedOrderFieldsForLineAppend(fresh),
      services: [...fresh.services, ...drafts.map(stripDraftIdentity)],
    },
    workspaceId,
  );
}

/**
 * Same as `appendOrderServiceLines` for materials: single catalog add uses add-and-issue RPC when present;
 * otherwise `updateOrder` runs the warehouse issue for the new catalog lines.
 */
export async function appendOrderMaterialLines(
  orderId: string,
  drafts: readonly OrderMaterial[],
  workspaceId: string | undefined,
): Promise<Order> {
  const fresh = await getOrder(orderId, workspaceId);
  // Estimates never issue stock — skip add-and-issue RPC (warehouse optional).
  if (fresh.kind !== "estimate" && drafts.length === 1 && isCatalogOrderMaterial(drafts[0]!)) {
    const viaRpc = await addCatalogMaterialViaRpc(orderId, drafts[0]!);
    if (viaRpc) return viaRpc;
  }
  return updateOrder(
    {
      orderId,
      ...preservedOrderFieldsForLineAppend(fresh),
      materials: [...(fresh.materials ?? []), ...drafts.map(stripDraftIdentity)],
    },
    workspaceId,
  );
}

/** Drafts must never carry an order-line id: that is what marks a line as "new" for discount stamping / inserts. */
function stripDraftIdentity<T extends { id?: string }>(draft: T): T {
  if (!("id" in draft)) return draft;
  const { id: _id, ...rest } = draft;
  void _id;
  return rest as T;
}
