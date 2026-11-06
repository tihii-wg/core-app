import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { InventoryItem } from "../../lib/types";
import { InventoryCard } from "./InventoryCard";

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

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
    <MemoryRouter initialEntries={["/en/ws-1/inventory"]}>
      <InventoryCard
        item={{ ...item, ...overrides }}
        formatMoney={(v) => (v == null ? "—" : `MDL ${v.toFixed(2)}`)}
        onView={onView}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </MemoryRouter>,
  );
  return { onView, onEdit, onDelete };
}

describe("InventoryCard", () => {
  it("shows name, SKU, supplier, stock status, quantity and purchase price", () => {
    renderCard();
    expect(screen.getByText("Front brake pads ceramic long name")).toBeInTheDocument();
    expect(screen.getByText("BP-CER-2026-XL")).toBeInTheDocument();
    expect(screen.getByText(/Acme Distribution International/)).toBeInTheDocument();
    expect(screen.getByText(/2 pcs/)).toBeInTheDocument();
    expect(screen.getByText("Purchase Price")).toBeInTheDocument();
    expect(screen.getByText("MDL 10.00")).toBeInTheDocument();
    expect(screen.queryByText("MDL 25.00")).not.toBeInTheDocument();
  });

  it("omits the supplier line when the item has no supplier", () => {
    renderCard({ supplier: "" });
    expect(screen.queryByText(/Supplier:/)).not.toBeInTheDocument();
  });

  it("links the supplier name without opening the card", async () => {
    const user = userEvent.setup();
    const { onView } = renderCard();
    const link = screen.getByRole("link", { name: "Acme Distribution International" });
    expect(link).toHaveAttribute("href", "/en/ws-1/suppliers/Acme%20Distribution%20International");
    await user.click(link);
    expect(onView).not.toHaveBeenCalled();
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
