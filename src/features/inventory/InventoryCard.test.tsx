import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { InventoryItem } from "../../lib/types";
import { InventoryCard } from "./InventoryCard";

const item: InventoryItem = {
  id: "item-1",
  workspaceId: "ws-1",
  name: "Front brake pads ceramic long name",
  sku: "BP-CER-2026-XL",
  description: "",
  category: "Brakes",
  quantity: 2,
  minQuantity: 5,
  unit: "pcs",
  purchasePrice: 10,
  sellingPrice: 25,
  supplier: "Acme Distribution International",
  location: "",
  isActive: true,
  stockStatus: "low_stock",
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
};

function renderCard(overrides: Partial<InventoryItem> = {}) {
  const onView = vi.fn();
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  render(
    <InventoryCard
      item={{ ...item, ...overrides }}
      formatMoney={(v) => (v == null ? "—" : `MDL ${v.toFixed(2)}`)}
      onView={onView}
      onEdit={onEdit}
      onDelete={onDelete}
    />,
  );
  return { onView, onEdit, onDelete };
}

describe("InventoryCard", () => {
  it("shows name, SKU, supplier, stock status, quantity and price", () => {
    renderCard();
    expect(screen.getByText("Front brake pads ceramic long name")).toBeInTheDocument();
    expect(screen.getByText("BP-CER-2026-XL")).toBeInTheDocument();
    expect(screen.getByText(/Acme Distribution International/)).toBeInTheDocument();
    expect(screen.getByText(/2 pcs/)).toBeInTheDocument();
    expect(screen.getByText("MDL 25.00")).toBeInTheDocument();
  });

  it("omits the supplier line when the item has no supplier", () => {
    renderCard({ supplier: "" });
    expect(screen.queryByText(/Supplier:/)).not.toBeInTheDocument();
  });

  it("keeps edit/delete in the menu without opening the item", async () => {
    const user = userEvent.setup();
    const { onView, onEdit, onDelete } = renderCard();

    const trigger = screen.getByRole("button", { name: "Actions for Front brake pads ceramic long name" });
    expect(trigger.className).toContain("size-10");
    await user.click(trigger);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(onView).not.toHaveBeenCalled();

    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "item-1" }));
    expect(onView).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });
});
