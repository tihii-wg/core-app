import i18n from "../../i18n";
import {
  getInventoryItem,
  purgeInventoryItem,
  updateInventoryItem,
  type InventoryItemDeletePreview,
} from "../../services/apiInventory";
import { roundQty } from "./warehouseOps";

export type CatalogRemovalEligibilityInput = {
  /** Quantity the user is returning on this line. */
  returnQty: number;
  /** Max still returnable from this receipt for the item. */
  maxReturnable: number;
  /** Current catalog / warehouse stock before the return. */
  stockQuantity: number;
  blockingOrdersCount: number;
  cancelledOrdersCount: number;
};

/**
 * Full return of the receipt's remaining qty that leaves catalog stock at 0,
 * and the part is unused by any order (including cancelled).
 */
export function isEligibleForCatalogRemoval(input: CatalogRemovalEligibilityInput): boolean {
  const returnQty = roundQty(input.returnQty);
  const maxReturnable = roundQty(input.maxReturnable);
  if (!(returnQty > 0) || !(maxReturnable > 0)) return false;
  if (Math.abs(returnQty - maxReturnable) >= 1e-9) return false;
  if (roundQty(input.stockQuantity - returnQty) !== 0) return false;
  if (input.blockingOrdersCount > 0) return false;
  if (input.cancelledOrdersCount > 0) return false;
  return true;
}

export function isEligibleFromPreview(
  returnQty: number,
  maxReturnable: number,
  preview: InventoryItemDeletePreview | null | undefined,
): boolean {
  if (!preview) return false;
  return isEligibleForCatalogRemoval({
    returnQty,
    maxReturnable,
    stockQuantity: preview.stockQuantity,
    blockingOrdersCount: preview.blockingOrders.length,
    cancelledOrdersCount: preview.cancelledOrdersCount,
  });
}

export type CatalogRemovalTarget = {
  inventoryItemId: string;
  itemName: string;
  isOwner: boolean;
};

export type CatalogRemovalFailure = {
  itemName: string;
  message: string;
};

export type CatalogRemovalResult = {
  removedCount: number;
  failures: CatalogRemovalFailure[];
};

/** Owner → purge; non-owner → deactivate. Failures do not throw — collected for toast. */
export async function removeCatalogItemsAfterReturn(
  targets: CatalogRemovalTarget[],
  workspaceId: string | undefined,
): Promise<CatalogRemovalResult> {
  let removedCount = 0;
  const failures: CatalogRemovalFailure[] = [];

  for (const target of targets) {
    try {
      if (target.isOwner) {
        await purgeInventoryItem(target.inventoryItemId, workspaceId);
      } else {
        await deactivateInventoryItem(target.inventoryItemId, workspaceId);
      }
      removedCount += 1;
    } catch (error) {
      failures.push({
        itemName: target.itemName,
        message: error instanceof Error ? error.message : i18n.t("inventory.errors.deleteFailed"),
      });
    }
  }

  return { removedCount, failures };
}

async function deactivateInventoryItem(itemId: string, workspaceId: string | undefined) {
  const item = await getInventoryItem(itemId, workspaceId);
  if (!item) throw new Error(i18n.t("inventory.errors.updateNotFound"));
  await updateInventoryItem(
    {
      id: item.id,
      name: item.name,
      sku: item.sku,
      description: item.description,
      category: item.category,
      quantity: item.quantity,
      minQuantity: item.minQuantity,
      unit: item.unit,
      purchasePrice: item.purchasePrice,
      sellingPrice: item.sellingPrice,
      supplier: item.supplier,
      location: item.location,
      isActive: false,
      warrantyType: item.warrantyType ?? null,
      warrantyMonths: item.warrantyMonths ?? null,
      warrantyKm: item.warrantyKm ?? null,
    },
    workspaceId,
  );
}
