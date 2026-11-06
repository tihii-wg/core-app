import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryItem } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
import { QuickGoodsReceiptDialog } from "./QuickGoodsReceiptDialog";

const mutate = vi.hoisted(() => vi.fn());

vi.mock("./useWarehouseOps", () => ({
  useCreateAndPostGoodsReceipt: () => ({ mutate, isPending: false, isError: false, error: null }),
}));

vi.mock("../warehouses/useGetWarehouses", () => ({
  useGetWarehouses: () => ({
    data: [{ id: "wh-1", name: "Main", isActive: true, isDefault: true }],
    isLoading: false,
  }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (value: number) => `MDL ${value.toFixed(2)}` }),
}));

const item: InventoryItem = {
  id: "item-1",
  workspaceId: "ws-1",
  name: "Oil filter",
  sku: "OF-1",
  description: "",
  category: "Filters",
  quantity: 3,
  minQuantity: 5,
  unit: "pcs",
  purchasePrice: 12,
  sellingPrice: 20,
  supplier: "  Acme Parts  ",
  location: "",
  isActive: true,
  stockStatus: "low_stock",
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
};

describe("QuickGoodsReceiptDialog", () => {
  beforeEach(() => {
    mutate.mockReset();
  });

  it("passes item.supplier as supplierName when receiving", async () => {
    const user = userEvent.setup();
    renderWithQuery(<QuickGoodsReceiptDialog open item={item} onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Receive stock|Receiving/i }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0]).toMatchObject({
      warehouseId: "wh-1",
      supplierName: "Acme Parts",
      lines: [expect.objectContaining({ inventoryItemId: "item-1", quantity: 1, unitCost: 12 })],
    });
  });

  it("passes null supplierName when the item has no supplier", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <QuickGoodsReceiptDialog open item={{ ...item, supplier: "   " }} onOpenChange={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: /Receive stock|Receiving/i }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0]).toMatchObject({ supplierName: null });
  });
});
