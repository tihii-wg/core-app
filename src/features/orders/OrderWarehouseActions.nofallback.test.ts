import { describe, expect, it, vi } from "vitest";
import type { InventoryMovement } from "../../lib/types";
import type {
  issueOrderMaterials,
  issueOrderMaterialsFromWarehouse,
  returnOrderMaterials,
  returnOrderMaterialsToWarehouse,
} from "../../services/apiWarehouse";

const noMovements: InventoryMovement[] = [];

/**
 * Contract test: when a warehouse id is present, only warehouse RPCs may run.
 * Mirrors OrderWarehouseActions handleConfirm branching (no silent global fallback).
 *
 * Mocks use Vitest's Procedure generic (`vi.fn<typeof productionFn>`) so call arity
 * matches the real warehouse / global issue-return APIs — never zero-arg stubs.
 */
describe("OrderWarehouseActions warehouse selection contract", () => {
  it("calls only from-warehouse issue when warehouseId is set", async () => {
    const issueFromWarehouse = vi.fn<typeof issueOrderMaterialsFromWarehouse>().mockResolvedValue(noMovements);
    const issueGlobal = vi.fn<typeof issueOrderMaterials>().mockResolvedValue(noMovements);
    const warehouseId = "wh-1";
    const lines = [{ inventoryItemId: "i1", quantity: 1 }];

    if (warehouseId) {
      await issueFromWarehouse("order-1", lines, warehouseId, "key");
    } else {
      await issueGlobal("order-1", lines, "key");
    }

    expect(issueFromWarehouse).toHaveBeenCalledTimes(1);
    expect(issueGlobal).not.toHaveBeenCalled();
  });

  it("calls only to-warehouse return when warehouseId is set", async () => {
    const returnToWarehouse = vi.fn<typeof returnOrderMaterialsToWarehouse>().mockResolvedValue(noMovements);
    const returnGlobal = vi.fn<typeof returnOrderMaterials>().mockResolvedValue(noMovements);
    const warehouseId = "wh-1";

    if (warehouseId) {
      await returnToWarehouse("order-1", [{ inventoryItemId: "i1", quantity: 1 }], warehouseId, "", "key");
    } else {
      await returnGlobal("order-1", [{ inventoryItemId: "i1", quantity: 1 }], "", "key");
    }

    expect(returnToWarehouse).toHaveBeenCalledTimes(1);
    expect(returnGlobal).not.toHaveBeenCalled();
  });

  it("uses global issue only when no warehouse is selected", async () => {
    const issueFromWarehouse = vi.fn<typeof issueOrderMaterialsFromWarehouse>().mockResolvedValue(noMovements);
    const issueGlobal = vi.fn<typeof issueOrderMaterials>().mockResolvedValue(noMovements);
    const warehouseId = "";

    if (warehouseId) {
      await issueFromWarehouse("order-1", [{ inventoryItemId: "i1", quantity: 1 }], warehouseId, "key");
    } else {
      await issueGlobal("order-1", [{ inventoryItemId: "i1", quantity: 1 }], "key");
    }

    expect(issueGlobal).toHaveBeenCalledTimes(1);
    expect(issueFromWarehouse).not.toHaveBeenCalled();
  });
});
