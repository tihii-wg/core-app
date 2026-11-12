import i18n from "../../i18n";
import type { Order, OrderMaterial } from "../../lib/types";
import { parseQuantity } from "../../lib/quantity";
import { isCatalogOrderMaterial } from "../inventory/orderMaterialLine";
import { getOrder, orderFromLineRpcPayload, updateOrder } from "../../services/apiOrders";
import { getWarehouseStock } from "../../services/apiWarehouseStock";
import { isMissingRpcError, MissingRpcError } from "../../services/missingRpc";
import supabase from "../../services/supabase";
import { requireWorkspaceId } from "../../services/missingTable";
import { preservedOrderFieldsForLineAppend } from "./appendOrderLines";
import { parseOrderServiceLinePrice } from "./updateOrderServiceLine";
import { materialQuantityStockDelta } from "./materialLineStockDelta";
import {
  catalogLineOutstanding,
  checkCatalogMaterialQuantity,
  otherCatalogLinesWarehouseClaim,
  parseInsufficientStockRpcMessage,
} from "./catalogMaterialStockLimit";
import { isLineDiscountType, roundMoney } from "./orderTotals";

export const CHANGE_ORDER_MATERIAL_QUANTITY_RPC = "crm_change_order_material_quantity";
export const UPDATE_ORDER_MATERIAL_LINE_RPC = "crm_update_order_material_line";
const SET_MATERIAL_PRICES_RPC = "crm_set_order_material_prices";

export type OrderMaterialLinePatch = {
  quantity?: number;
  price?: number;
  warehouseId?: string | null;
  warrantyMonths?: number | null;
  warrantyDays?: number | null;
  warrantyKm?: number | null;
  discountType?: "percent" | "amount" | null;
  discountValue?: number | null;
};

export type InsufficientMaterialStock = {
  warehouseId: string;
  warehouseName?: string;
  available: number;
  needed: number;
  materialName: string;
  /** Max quantity the line may hold given stock + outstanding − siblings. */
  maxQuantity?: number;
};

export class InsufficientMaterialStockError extends Error {
  readonly detail: InsufficientMaterialStock;

  constructor(detail: InsufficientMaterialStock, message: string) {
    super(message);
    this.name = "InsufficientMaterialStockError";
    this.detail = detail;
  }
}

function patchTouchesWarranty(patch: OrderMaterialLinePatch): boolean {
  return patch.warrantyMonths !== undefined || patch.warrantyDays !== undefined || patch.warrantyKm !== undefined;
}

function patchTouchesDiscount(patch: OrderMaterialLinePatch): boolean {
  return patch.discountType !== undefined || patch.discountValue !== undefined;
}

function patchTouchesExtendedFields(patch: OrderMaterialLinePatch): boolean {
  return (
    patch.warehouseId !== undefined ||
    patchTouchesWarranty(patch) ||
    patchTouchesDiscount(patch)
  );
}

/** Apply a patch onto one material line; other fields stay unchanged. `null` clears optional fields. */
export function applyOrderMaterialLinePatch(line: OrderMaterial, patch: OrderMaterialLinePatch): OrderMaterial {
  return {
    ...line,
    ...(patch.price !== undefined ? { price: roundMoney(patch.price) } : {}),
    ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
    ...(patch.warehouseId !== undefined
      ? { warehouseId: patch.warehouseId?.trim() ? patch.warehouseId.trim() : undefined }
      : {}),
    ...(patch.warrantyMonths !== undefined ? { warrantyMonths: patch.warrantyMonths } : {}),
    ...(patch.warrantyDays !== undefined ? { warrantyDays: patch.warrantyDays } : {}),
    ...(patch.warrantyKm !== undefined ? { warrantyKm: patch.warrantyKm } : {}),
    ...(patch.discountType !== undefined ? { discountType: patch.discountType } : {}),
    ...(patch.discountValue !== undefined ? { discountValue: patch.discountValue } : {}),
  };
}

/** Diff a draft line against the saved line into a sparse patch (absent = unchanged). */
export function diffOrderMaterialLinePatch(original: OrderMaterial, draft: OrderMaterial): OrderMaterialLinePatch {
  const patch: OrderMaterialLinePatch = {};
  if (roundMoney(Number(draft.price) || 0) !== roundMoney(Number(original.price) || 0)) {
    patch.price = roundMoney(Number(draft.price) || 0);
  }
  if (Number(draft.quantity) !== Number(original.quantity)) {
    patch.quantity = Number(draft.quantity);
  }
  const nextWh = draft.warehouseId?.trim() || null;
  const prevWh = original.warehouseId?.trim() || null;
  if (nextWh !== prevWh) patch.warehouseId = nextWh;

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

export function orderMaterialLinePatchIsEmpty(patch: OrderMaterialLinePatch): boolean {
  return Object.keys(patch).length === 0;
}

/** Test helper: build the materials array that would result from a single-line patch. */
export function patchMaterialsForLineUpdate(
  materials: readonly OrderMaterial[],
  lineId: string,
  patch: OrderMaterialLinePatch,
): OrderMaterial[] {
  return materials.map((line) => (line.id === lineId ? applyOrderMaterialLinePatch(line, patch) : line));
}

function mapMaterialLineRpcError(error: { message?: string; code?: string } | null | undefined): Error | null {
  if (!error?.message) return null;
  const message = error.message;
  if (
    /update_order_material_line:closed_order_immutable|change_order_material_quantity:closed_order_immutable|order_lifecycle:closed_order_immutable/i.test(
      message,
    )
  ) {
    return new Error(i18n.t("orders.lifecycle.errors.closedOrderImmutable"));
  }
  if (
    /update_order_material_line:cancelled_order_immutable|change_order_material_quantity:cancelled_order_immutable/i.test(
      message,
    )
  ) {
    return new Error(i18n.t("orders.lifecycle.errors.closedOrderImmutable"));
  }
  if (
    /change_order_material_quantity:below_outstanding|cannot be less than outstanding|cannotReduceBelowIssued|Requested quantity cannot be less than already issued/i.test(
      message,
    )
  ) {
    return new Error(i18n.t("orders.errors.cannotReduceBelowIssued"));
  }
  if (
    /update_order_material_line:warehouse_required|change_order_material_quantity:warehouse_required/i.test(message)
  ) {
    return new Error(i18n.t("orders.warehouse.warehouseRequired"));
  }
  if (/update_order_material_line:warehouse_locked_after_issue/i.test(message)) {
    return new Error(i18n.t("orders.lineEdit.returnBeforeChangeWarehouse"));
  }
  if (
    /update_order_material_line:warehouse_permission|change_order_material_quantity:warehouse_permission|You do not have permission to issue warehouse/i.test(
      message,
    )
  ) {
    return new Error(i18n.t("orders.errors.warehousePermission"));
  }
  if (/order_material:insufficient_stock|insufficient_warehouse_stock|insufficient_batch_stock/i.test(message)) {
    const parsed = parseInsufficientStockRpcMessage(message);
    if (parsed?.available != null) {
      return new InsufficientMaterialStockError(
        {
          warehouseId: "",
          available: parsed.available,
          needed: parsed.requested ?? parsed.available,
          materialName: "",
          maxQuantity: parsed.available,
        },
        i18n.t("orders.form.onlyNAvailableOnWarehouse", {
          available: parsed.available,
          warehouse: "",
        }),
      );
    }
    return new Error(i18n.t("orders.errors.insufficientWarehouseStock"));
  }
  if (/insufficient_stock/i.test(message)) {
    return new Error(i18n.t("orders.errors.insufficientStock"));
  }
  if (
    /update_order_material_line:line_not_found|update_order_material_line:order_not_found|change_order_material_quantity:line_not_found|change_order_material_quantity:order_not_found/i.test(
      message,
    )
  ) {
    return new Error(i18n.t("orders.errors.materialsSyncFailed"));
  }
  if (
    /update_order_material_line:forbidden|update_order_material_line:not_authenticated|change_order_material_quantity:forbidden|change_order_material_quantity:not_authenticated/i.test(
      message,
    )
  ) {
    return new Error(i18n.t("orders.errors.warehousePermission"));
  }
  if (
    /update_order_material_line:invalid_quantity|change_order_material_quantity:invalid_quantity/i.test(message)
  ) {
    return new Error(i18n.t("orders.validation.quantityMin"));
  }
  if (/update_order_material_line:invalid_price/i.test(message)) {
    return new Error(i18n.t("orders.errors.materialPriceInvalid"));
  }
  return null;
}

/**
 * Preflight stock check for a catalog quantity increase. Throws InsufficientMaterialStockError
 * when the line's warehouse cannot cover the new quantity (on-hand + this line's outstanding −
 * sibling claims). Same hard block as issue / add-and-issue RPCs — stock must never go negative.
 */
export async function assertWarehouseCanCoverQuantityIncrease(
  workspaceId: string,
  line: OrderMaterial,
  nextQuantity: number,
  warehouseName?: string,
  siblingLines: readonly OrderMaterial[] = [],
): Promise<void> {
  if (!isCatalogOrderMaterial(line)) return;
  const delta = materialQuantityStockDelta(line, nextQuantity);
  if (delta.kind === "none" || delta.kind === "return") return;
  if (delta.kind === "blocked") {
    throw new Error(i18n.t("orders.errors.cannotReduceBelowIssued"));
  }
  const warehouseId = line.warehouseId?.trim();
  if (!warehouseId) throw new Error(i18n.t("orders.warehouse.warehouseRequired"));
  const itemId = line.inventoryItemId?.trim();
  if (!itemId) return;

  const stock = await getWarehouseStock(workspaceId, { inventoryItemId: itemId });
  const availableOnHand = stock
    .filter((entry) => entry.warehouseId === warehouseId)
    .reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);
  const outstanding = catalogLineOutstanding(line);
  const otherClaim = otherCatalogLinesWarehouseClaim(siblingLines, itemId, warehouseId, {
    lineId: line.id,
  });
  const check = checkCatalogMaterialQuantity({
    desiredQuantity: nextQuantity,
    warehouseOnHand: availableOnHand,
    lineOutstanding: outstanding,
    otherLinesClaim: otherClaim,
  });
  if (check.ok) return;

  throw new InsufficientMaterialStockError(
    {
      warehouseId,
      warehouseName,
      available: check.availableOnHand,
      needed: check.neededFromWarehouse,
      materialName: line.itemName,
      maxQuantity: check.max,
    },
    i18n.t("orders.form.onlyNAvailableOnWarehouse", {
      available: check.max,
      warehouse: warehouseName?.trim() || warehouseId,
    }),
  );
}

async function updateOrderMaterialLineViaRpc(
  orderId: string,
  lineId: string,
  patch: OrderMaterialLinePatch,
  merged: OrderMaterial,
): Promise<Order | null> {
  const setWarranty = patchTouchesWarranty(patch);
  const setDiscount = patchTouchesDiscount(patch);
  const setWarehouse = patch.warehouseId !== undefined;

  const { data, error } = await supabase.rpc(UPDATE_ORDER_MATERIAL_LINE_RPC, {
    p_order_id: orderId,
    p_line_id: lineId,
    p_quantity: patch.quantity ?? null,
    p_price: patch.price ?? null,
    p_warehouse_id: setWarehouse ? (merged.warehouseId?.trim() || null) : null,
    p_set_warehouse: setWarehouse,
    p_warranty_months: setWarranty ? (merged.warrantyMonths ?? null) : null,
    p_warranty_days: setWarranty ? (merged.warrantyDays ?? null) : null,
    p_warranty_km: setWarranty ? (merged.warrantyKm ?? null) : null,
    p_set_warranty: setWarranty,
    p_discount_type: setDiscount ? (merged.discountType ?? null) : null,
    p_discount_value: setDiscount ? (merged.discountValue ?? null) : null,
    p_set_discount: setDiscount,
  });
  if (error) {
    if (isMissingRpcError(error, UPDATE_ORDER_MATERIAL_LINE_RPC)) return null;
    throw mapMaterialLineRpcError(error) ?? new Error(error.message);
  }
  const order = orderFromLineRpcPayload(data);
  if (!order) throw new Error("Invalid order payload");
  return order;
}

async function changeMaterialQuantityViaRpc(
  orderId: string,
  lineId: string,
  quantity: number,
): Promise<Order | null> {
  const { data, error } = await supabase.rpc(CHANGE_ORDER_MATERIAL_QUANTITY_RPC, {
    p_order_id: orderId,
    p_order_material_id: lineId,
    p_quantity: quantity,
  });
  if (error) {
    if (isMissingRpcError(error, CHANGE_ORDER_MATERIAL_QUANTITY_RPC)) {
      throw new MissingRpcError(
        CHANGE_ORDER_MATERIAL_QUANTITY_RPC,
        i18n.t("orders.materialInline.quantityRpcRequired", { rpc: CHANGE_ORDER_MATERIAL_QUANTITY_RPC }),
      );
    }
    throw mapMaterialLineRpcError(error) ?? new Error(error.message);
  }
  return orderFromLineRpcPayload(data);
}

async function changeMaterialPriceViaRpc(orderId: string, lineId: string, price: number): Promise<Order | null> {
  const { data, error } = await supabase.rpc(SET_MATERIAL_PRICES_RPC, {
    p_order_id: orderId,
    p_lines: [{ line_id: lineId, price }],
  });
  if (error) {
    if (isMissingRpcError(error, SET_MATERIAL_PRICES_RPC)) {
      throw new MissingRpcError(SET_MATERIAL_PRICES_RPC, i18n.t("orders.errors.materialPriceRpcRequired"));
    }
    if (/order_material_price:forbidden/i.test(error.message)) {
      throw new Error(i18n.t("orders.errors.materialPriceForbidden"));
    }
    if (/order_lifecycle:closed_order_immutable/i.test(error.message)) {
      throw new Error(i18n.t("orders.lifecycle.errors.closedOrderImmutable"));
    }
    throw new Error(error.message || i18n.t("orders.errors.materialPriceInvalid"));
  }
  return orderFromLineRpcPayload(data);
}

/**
 * Patches ONE material line by `order_materials.id`. Prefers `crm_update_order_material_line`
 * (quantity with stock, price, warehouse, warranty, discount + full order). Falls back to the
 * quantity/price RPCs plus `updateOrder` for warranty/warehouse/discount when the new RPC is missing.
 */
export async function updateOrderMaterialLine(
  orderId: string,
  lineId: string,
  patch: OrderMaterialLinePatch,
  workspaceId: string | undefined,
  options?: { warehouseName?: string; skipStockPreflight?: boolean },
): Promise<Order> {
  const id = lineId.trim();
  if (!id) throw new Error("Material line id is required");
  const ws = requireWorkspaceId(workspaceId);

  let nextPatch = { ...patch };
  if (nextPatch.price !== undefined) {
    const price = parseOrderServiceLinePrice(nextPatch.price);
    if (price === "invalid") throw new Error(i18n.t("orders.errors.materialPriceInvalid"));
    nextPatch = { ...nextPatch, price };
  }
  if (nextPatch.quantity !== undefined) {
    const quantity = parseQuantity(nextPatch.quantity);
    if (typeof quantity !== "number") throw new Error(i18n.t("orders.validation.quantityMin"));
    nextPatch = { ...nextPatch, quantity };
  }
  if (nextPatch.discountType !== undefined && nextPatch.discountType != null && !isLineDiscountType(nextPatch.discountType)) {
    throw new Error("Invalid discount type");
  }

  const fresh = await getOrder(orderId, ws);
  if (fresh.status === "cancelled") {
    throw new Error(i18n.t("orders.lifecycle.errors.closedOrderImmutable"));
  }
  const materials = fresh.materials ?? [];
  const index = materials.findIndex((line) => line.id === id);
  if (index < 0) throw new Error(i18n.t("orders.errors.materialsSyncFailed"));
  const current = materials[index]!;
  const merged = applyOrderMaterialLinePatch(current, nextPatch);

  if (nextPatch.quantity !== undefined && nextPatch.quantity !== Number(current.quantity)) {
    const delta = materialQuantityStockDelta(
      nextPatch.warehouseId !== undefined
        ? { ...current, warehouseId: nextPatch.warehouseId ?? undefined }
        : current,
      nextPatch.quantity,
    );
    if (delta.kind === "blocked") {
      throw new Error(i18n.t("orders.errors.cannotReduceBelowIssued"));
    }
    if (!options?.skipStockPreflight && delta.kind === "issue") {
      await assertWarehouseCanCoverQuantityIncrease(
        ws,
        nextPatch.warehouseId !== undefined
          ? { ...current, warehouseId: nextPatch.warehouseId ?? undefined }
          : current,
        nextPatch.quantity,
        options?.warehouseName,
        materials,
      );
    }
  }

  if (nextPatch.warehouseId !== undefined) {
    const issued = Number(current.quantityIssued ?? 0);
    const returned = Number(current.quantityReturned ?? 0);
    if (issued !== 0 || returned !== 0) {
      throw new Error(i18n.t("orders.lineEdit.returnBeforeChangeWarehouse"));
    }
  }

  const viaRpc = await updateOrderMaterialLineViaRpc(orderId, id, nextPatch, merged);
  if (viaRpc) return viaRpc;

  // Legacy fallback before crm_update_order_material_line is applied.
  let fromRpc: Order | null = null;

  if (nextPatch.quantity !== undefined && nextPatch.quantity !== Number(current.quantity)) {
    fromRpc = await changeMaterialQuantityViaRpc(orderId, id, nextPatch.quantity);
  }

  if (nextPatch.price !== undefined && roundMoney(nextPatch.price) !== roundMoney(Number(current.price))) {
    fromRpc = (await changeMaterialPriceViaRpc(orderId, id, nextPatch.price)) ?? fromRpc;
  }

  if (patchTouchesExtendedFields(nextPatch)) {
    const base = fromRpc ?? fresh;
    const nextMaterials = (base.materials ?? []).map((line) =>
      line.id === id ? applyOrderMaterialLinePatch(line, nextPatch) : line,
    );
    return updateOrder(
      {
        orderId,
        ...preservedOrderFieldsForLineAppend(base),
        materials: nextMaterials,
        services: base.services,
      },
      ws,
    );
  }

  if (fromRpc) return fromRpc;
  return getOrder(orderId, ws);
}
