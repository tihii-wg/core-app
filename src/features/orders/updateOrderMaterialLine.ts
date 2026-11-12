import i18n from "../../i18n";
import type { Order, OrderMaterial } from "../../lib/types";
import { parseQuantity } from "../../lib/quantity";
import { isCatalogOrderMaterial } from "../inventory/orderMaterialLine";
import { getOrder, orderFromLineRpcPayload } from "../../services/apiOrders";
import { getWarehouseStock } from "../../services/apiWarehouseStock";
import { isMissingRpcError, MissingRpcError } from "../../services/missingRpc";
import supabase from "../../services/supabase";
import { requireWorkspaceId } from "../../services/missingTable";
import { parseOrderServiceLinePrice } from "./updateOrderServiceLine";
import { materialQuantityStockDelta } from "./materialLineStockDelta";
import {
  catalogLineOutstanding,
  checkCatalogMaterialQuantity,
  otherCatalogLinesWarehouseClaim,
  parseInsufficientStockRpcMessage,
} from "./catalogMaterialStockLimit";
import { roundMoney } from "./orderTotals";

export const CHANGE_ORDER_MATERIAL_QUANTITY_RPC = "crm_change_order_material_quantity";
const SET_MATERIAL_PRICES_RPC = "crm_set_order_material_prices";

export type OrderMaterialLinePatch = {
  quantity?: number;
  price?: number;
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

/** Apply a patch onto one material line; other fields stay unchanged. */
export function applyOrderMaterialLinePatch(line: OrderMaterial, patch: OrderMaterialLinePatch): OrderMaterial {
  return {
    ...line,
    ...(patch.price !== undefined ? { price: roundMoney(patch.price) } : {}),
    ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
  };
}

/** Test helper: build the materials array that would result from a single-line patch. */
export function patchMaterialsForLineUpdate(
  materials: readonly OrderMaterial[],
  lineId: string,
  patch: OrderMaterialLinePatch,
): OrderMaterial[] {
  return materials.map((line) => (line.id === lineId ? applyOrderMaterialLinePatch(line, patch) : line));
}

function mapQuantityRpcError(error: { message?: string; code?: string } | null | undefined): Error | null {
  if (!error?.message) return null;
  const message = error.message;
  if (/change_order_material_quantity:closed_order_immutable|order_lifecycle:closed_order_immutable/i.test(message)) {
    return new Error(i18n.t("orders.lifecycle.errors.closedOrderImmutable"));
  }
  if (/change_order_material_quantity:cancelled_order_immutable/i.test(message)) {
    return new Error(i18n.t("orders.lifecycle.errors.closedOrderImmutable"));
  }
  if (/change_order_material_quantity:below_outstanding|cannot be less than outstanding|cannotReduceBelowIssued|Requested quantity cannot be less than already issued/i.test(message)) {
    return new Error(i18n.t("orders.errors.cannotReduceBelowIssued"));
  }
  if (/change_order_material_quantity:warehouse_required/i.test(message)) {
    return new Error(i18n.t("orders.warehouse.warehouseRequired"));
  }
  if (/change_order_material_quantity:warehouse_permission|You do not have permission to issue warehouse/i.test(message)) {
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
  if (/change_order_material_quantity:line_not_found|change_order_material_quantity:order_not_found/i.test(message)) {
    return new Error(i18n.t("orders.errors.materialsSyncFailed"));
  }
  if (/change_order_material_quantity:forbidden|change_order_material_quantity:not_authenticated/i.test(message)) {
    return new Error(i18n.t("orders.errors.warehousePermission"));
  }
  if (/change_order_material_quantity:invalid_quantity/i.test(message)) {
    return new Error(i18n.t("orders.validation.quantityMin"));
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
    throw mapQuantityRpcError(error) ?? new Error(error.message);
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
 * Re-reads the order, patches ONE material line by `order_materials.id`.
 * Quantity (catalog) goes through crm_change_order_material_quantity (stock + totals).
 * Price goes through crm_set_order_material_prices (no stock).
 * Other lines are never rewritten from the client.
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

  const fresh = await getOrder(orderId, ws);
  if (fresh.status === "cancelled") {
    throw new Error(i18n.t("orders.lifecycle.errors.closedOrderImmutable"));
  }
  const materials = fresh.materials ?? [];
  const index = materials.findIndex((line) => line.id === id);
  if (index < 0) throw new Error(i18n.t("orders.errors.materialsSyncFailed"));
  const current = materials[index]!;

  let fromRpc: Order | null = null;

  if (nextPatch.quantity !== undefined && nextPatch.quantity !== Number(current.quantity)) {
    const delta = materialQuantityStockDelta(current, nextPatch.quantity);
    if (delta.kind === "blocked") {
      throw new Error(i18n.t("orders.errors.cannotReduceBelowIssued"));
    }
    if (!options?.skipStockPreflight && delta.kind === "issue") {
      await assertWarehouseCanCoverQuantityIncrease(
        ws,
        current,
        nextPatch.quantity,
        options?.warehouseName,
        materials,
      );
    }
    fromRpc = await changeMaterialQuantityViaRpc(orderId, id, nextPatch.quantity);
  }

  if (nextPatch.price !== undefined && roundMoney(nextPatch.price) !== roundMoney(Number(current.price))) {
    fromRpc = (await changeMaterialPriceViaRpc(orderId, id, nextPatch.price)) ?? fromRpc;
  }

  if (fromRpc) return fromRpc;
  return getOrder(orderId, ws);
}
