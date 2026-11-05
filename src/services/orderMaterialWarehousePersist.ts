/**
 * Warehouse-first persistence for catalog order materials.
 *
 * Freeform lines still go through sync_order_materials (unchanged).
 * Catalog lines use atomic add/issue RPCs so a line never appears saved without stock deduction.
 *
 * Multi-line create/update is sequential per catalog line with best-effort return compensation
 * on create failure. True multi-line atomicity requires the batch SQL documented in
 * supabase/manual/20261103220000_add_and_issue_order_catalog_material.PRODUCTION.sql.
 */
import {
  consolidateOrderMaterials,
  isCatalogOrderMaterial,
  resolveMaterialSupplySource,
} from "../features/inventory/orderMaterialLine";
import type { OrderMaterial } from "../lib/types";
import i18n from "../i18n";
import {
  addAndIssueOrderCatalogMaterial,
  setOrderCatalogMaterialQuantityWithIssue,
} from "./apiOrderMaterialStock";
import { returnOrderMaterialsToWarehouse } from "./apiWarehouse";

export function assertCatalogWarehousesSelected(materials: readonly OrderMaterial[]): void {
  for (const line of consolidateOrderMaterials([...materials])) {
    if (!isCatalogOrderMaterial(line)) continue;
    if (!line.warehouseId?.trim()) {
      throw new Error(i18n.t("orders.warehouse.warehouseRequired"));
    }
  }
}

function catalogKey(line: OrderMaterial): string {
  return line.inventoryItemId?.trim() ?? "";
}

type IssuedForCompensation = {
  inventoryItemId: string;
  warehouseId: string;
  quantity: number;
};

/**
 * Applies catalog immediate-issue RPCs for new lines and quantity increases.
 * Returns the catalog lines as the RPCs left them (ids + issued counters).
 * Does not call sync_order_materials.
 */
export async function applyCatalogImmediateIssue(params: {
  orderId: string;
  desired: OrderMaterial[];
  existing: OrderMaterial[];
}): Promise<{ catalog: OrderMaterial[]; issuedForCompensation: IssuedForCompensation[] }> {
  const desired = consolidateOrderMaterials(params.desired).filter(isCatalogOrderMaterial);
  const existingByItem = new Map(
    params.existing.filter(isCatalogOrderMaterial).map((line) => [catalogKey(line), line] as const),
  );

  assertCatalogWarehousesSelected(desired);

  const catalog: OrderMaterial[] = [];
  const issuedForCompensation: IssuedForCompensation[] = [];

  for (const line of desired) {
    const itemId = catalogKey(line);
    const warehouseId = line.warehouseId!.trim();
    const existing = existingByItem.get(itemId);
    const issued = Number(existing?.quantityIssued ?? 0);
    const returned = Number(existing?.quantityReturned ?? 0);
    const outstanding = Math.max(0, issued - returned);

    if (line.quantity < outstanding) {
      throw new Error(i18n.t("orders.errors.cannotReduceBelowIssued"));
    }

    // Keep desired identity + warranty so apply_order_material_warranties can match the
    // persisted row. Issue RPCs do not round-trip warranty_* (or always inventory_item_id).
    const withWarranty = (material: OrderMaterial): OrderMaterial => ({
      ...material,
      inventoryItemId: material.inventoryItemId?.trim() || line.inventoryItemId,
      itemName: material.itemName || line.itemName,
      warehouseId: material.warehouseId?.trim() || warehouseId,
      supplySource: "catalog",
      warrantyMonths: line.warrantyMonths,
      warrantyDays: line.warrantyDays,
      warrantyKm: line.warrantyKm,
    });

    if (!existing?.id) {
      const { material } = await addAndIssueOrderCatalogMaterial({
        orderId: params.orderId,
        warehouseId,
        inventoryItemId: itemId,
        quantity: line.quantity,
        price: line.price,
        idempotencyKey: crypto.randomUUID(),
      });
      catalog.push(withWarranty(material));
      issuedForCompensation.push({
        inventoryItemId: itemId,
        warehouseId,
        quantity: line.quantity,
      });
      continue;
    }

    if (line.quantity > issued) {
      const { material } = await setOrderCatalogMaterialQuantityWithIssue({
        orderId: params.orderId,
        orderMaterialId: existing.id,
        warehouseId,
        quantity: line.quantity,
        idempotencyKey: crypto.randomUUID(),
      });
      const delta = line.quantity - issued;
      if (delta > 0) {
        issuedForCompensation.push({ inventoryItemId: itemId, warehouseId, quantity: delta });
      }
      catalog.push(withWarranty(material));
      continue;
    }

    // Quantity unchanged or reduced toward (but not below) outstanding issued — no new issue.
    // sync_order_materials will persist the requested quantity without touching stock.
    catalog.push(
      withWarranty({
        ...existing,
        quantity: line.quantity,
        warehouseId,
        supplySource: "catalog",
      }),
    );
  }

  return { catalog, issuedForCompensation };
}

/** Best-effort stock restore after a failed create (not a substitute for a batch RPC). */
export async function compensateIssuedCatalogMaterials(
  orderId: string,
  issued: readonly IssuedForCompensation[],
): Promise<void> {
  for (const line of issued) {
    try {
      await returnOrderMaterialsToWarehouse(
        orderId,
        [{ inventoryItemId: line.inventoryItemId, quantity: line.quantity }],
        line.warehouseId,
        "create_order_rollback",
        crypto.randomUUID(),
      );
    } catch {
      // Best-effort only; document residual risk in the backend report.
    }
  }
}

export function freeformMaterialsOnly(materials: readonly OrderMaterial[]): OrderMaterial[] {
  return consolidateOrderMaterials([...materials]).filter((line) => resolveMaterialSupplySource(line) !== "catalog");
}

export function mergeCatalogAndFreeform(catalog: OrderMaterial[], freeform: OrderMaterial[]): OrderMaterial[] {
  return consolidateOrderMaterials([...catalog, ...freeform]);
}
