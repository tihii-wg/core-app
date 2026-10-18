import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import type { InventoryItem } from "../../lib/types";
import InventoryItemCombobox from "./InventoryItemCombobox";

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (value: number) => `MDL ${value.toFixed(2)}` }),
}));

const pads: InventoryItem = {
  id: "item-1",
  workspaceId: "ws-1",
  name: "Brake pads",
  sku: "BP-1",
  description: "",
  category: "Brakes",
  quantity: 4,
  minQuantity: 1,
  unit: "pcs",
  purchasePrice: 8,
  sellingPrice: 12,
  supplier: "",
  location: "",
  isActive: true,
  stockStatus: "in_stock",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("InventoryItemCombobox", () => {
  it("shows create-new when search has no matches and calls onCreateRequest", async () => {
    const user = userEvent.setup();
    const onCreateRequest = vi.fn();
    renderWithQuery(<InventoryItemCombobox items={[pads]} onCreateRequest={onCreateRequest} />);

    await user.click(screen.getByPlaceholderText("Search parts and materials..."));
    await user.type(screen.getByPlaceholderText("Search parts and materials..."), "Synthetic oil");

    expect(screen.getByText("No matching inventory items")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+ Create new material" }));
    expect(onCreateRequest).toHaveBeenCalledWith("Synthetic oil");
  });

  it("does not show create-new when matches exist", async () => {
    const user = userEvent.setup();
    renderWithQuery(<InventoryItemCombobox items={[pads]} onCreateRequest={vi.fn()} />);

    await user.click(screen.getByPlaceholderText("Search parts and materials..."));
    await user.type(screen.getByPlaceholderText("Search parts and materials..."), "Brake");

    expect(screen.getByRole("button", { name: /Brake pads/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Create new material" })).not.toBeInTheDocument();
  });

  it("selects a matching item", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithQuery(<InventoryItemCombobox items={[pads]} onSelect={onSelect} />);

    await user.click(screen.getByPlaceholderText("Search parts and materials..."));
    await user.click(screen.getByRole("button", { name: /Brake pads/ }));

    expect(onSelect).toHaveBeenCalledWith(pads);
  });
});
