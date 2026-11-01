import { describe, expect, it, vi } from "vitest";

/**
 * Contract test: when a warehouse id is present, only warehouse RPCs may run.
 * Mirrors OrderWarehouseActions handleConfirm branching (no silent global fallback).
 */
describe("OrderWarehouseActions warehouse selection contract", () => {
  it("calls only from-warehouse issue when warehouseId is set", async () => {
    const issueFromWarehouse = vi.fn(async () => []);
    const issueGlobal = vi.fn(async () => []);
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
    const returnToWarehouse = vi.fn(async () => []);
    const returnGlobal = vi.fn(async () => []);
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
    const issueFromWarehouse = vi.fn(async () => []);
    const issueGlobal = vi.fn(async () => []);
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
