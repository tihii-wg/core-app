import { beforeEach, describe, expect, it, vi } from "vitest";
import { isEligibleForCatalogRemoval, removeCatalogItemsAfterReturn } from "./supplierReturnCatalogRemoval";

const purgeInventoryItem = vi.hoisted(() => vi.fn());
const getInventoryItem = vi.hoisted(() => vi.fn());
const updateInventoryItem = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiInventory", () => ({
  purgeInventoryItem: (...args: unknown[]) => purgeInventoryItem(...args),
  getInventoryItem: (...args: unknown[]) => getInventoryItem(...args),
  updateInventoryItem: (...args: unknown[]) => updateInventoryItem(...args),
}));

describe("isEligibleForCatalogRemoval", () => {
  it("allows a full return that brings stock to zero with no order usage", () => {
    expect(
      isEligibleForCatalogRemoval({
        returnQty: 2,
        maxReturnable: 2,
        stockQuantity: 2,
        blockingOrdersCount: 0,
        cancelledOrdersCount: 0,
      }),
    ).toBe(true);
  });

  it("rejects a partial return", () => {
    expect(
      isEligibleForCatalogRemoval({
        returnQty: 1,
        maxReturnable: 2,
        stockQuantity: 2,
        blockingOrdersCount: 0,
        cancelledOrdersCount: 0,
      }),
    ).toBe(false);
  });

  it("rejects when other stock would remain", () => {
    expect(
      isEligibleForCatalogRemoval({
        returnQty: 2,
        maxReturnable: 2,
        stockQuantity: 5,
        blockingOrdersCount: 0,
        cancelledOrdersCount: 0,
      }),
    ).toBe(false);
  });

  it("rejects when the item is used on a non-cancelled order", () => {
    expect(
      isEligibleForCatalogRemoval({
        returnQty: 2,
        maxReturnable: 2,
        stockQuantity: 2,
        blockingOrdersCount: 1,
        cancelledOrdersCount: 0,
      }),
    ).toBe(false);
  });

  it("rejects when cancelled orders still reference the item", () => {
    expect(
      isEligibleForCatalogRemoval({
        returnQty: 2,
        maxReturnable: 2,
        stockQuantity: 2,
        blockingOrdersCount: 0,
        cancelledOrdersCount: 1,
      }),
    ).toBe(false);
  });
});

describe("removeCatalogItemsAfterReturn", () => {
  beforeEach(() => {
    purgeInventoryItem.mockReset();
    getInventoryItem.mockReset();
    updateInventoryItem.mockReset();
  });

  it("purges for owners and deactivates for non-owners", async () => {
    purgeInventoryItem.mockResolvedValue({ deleted: true });
    getInventoryItem.mockResolvedValue({
      id: "i2",
      name: "Pad",
      sku: "P",
      description: "",
      category: "",
      quantity: 0,
      minQuantity: 0,
      unit: "pcs",
      purchasePrice: null,
      sellingPrice: null,
      supplier: "",
      location: "",
      isActive: true,
    });
    updateInventoryItem.mockResolvedValue({});

    const result = await removeCatalogItemsAfterReturn(
      [
        { inventoryItemId: "i1", itemName: "Filter", isOwner: true },
        { inventoryItemId: "i2", itemName: "Pad", isOwner: false },
      ],
      "ws-1",
    );

    expect(purgeInventoryItem).toHaveBeenCalledWith("i1", "ws-1");
    expect(updateInventoryItem).toHaveBeenCalledWith(expect.objectContaining({ id: "i2", isActive: false }), "ws-1");
    expect(result).toEqual({ removedCount: 2, failures: [] });
  });

  it("collects failures without throwing so the return stays posted", async () => {
    purgeInventoryItem.mockRejectedValue(new Error("in use"));

    const result = await removeCatalogItemsAfterReturn(
      [{ inventoryItemId: "i1", itemName: "Filter", isOwner: true }],
      "ws-1",
    );

    expect(result.removedCount).toBe(0);
    expect(result.failures).toEqual([{ itemName: "Filter", message: "in use" }]);
  });
});
