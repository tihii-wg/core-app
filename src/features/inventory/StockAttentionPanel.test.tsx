import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { InventoryItem } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
import { StockAttentionPanel } from "./StockAttentionPanel";

function item(partial: Partial<InventoryItem>): InventoryItem {
  return {
    id: "item-1",
    workspaceId: "ws-1",
    name: "Pads",
    sku: "P-1",
    description: "",
    category: "Parts",
    quantity: 5,
    minQuantity: 2,
    unit: "pcs",
    purchasePrice: 1,
    sellingPrice: 2,
    supplier: "",
    location: "",
    isActive: true,
    stockStatus: "in_stock",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...partial,
  };
}

describe("StockAttentionPanel", () => {
  it("shows a healthy empty state when active stock is above minimums", () => {
    renderWithQuery(
      <StockAttentionPanel
        items={[item({ stockStatus: "in_stock", quantity: 10, minQuantity: 2 })]}
        activeFilter="all"
        onFilter={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    );

    expect(screen.getByText("Stock looks healthy")).toBeInTheDocument();
    expect(screen.queryByText(/Order material requests do not change stock/)).not.toBeInTheDocument();
  });

  it("renders nothing when the workspace has no inventory items", () => {
    const { container } = renderWithQuery(
      <StockAttentionPanel items={[]} activeFilter="all" onFilter={vi.fn()} onOpenItem={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("filters the list from count buttons and opens an item from the preview", async () => {
    const user = userEvent.setup();
    const onFilter = vi.fn();
    const onOpenItem = vi.fn();
    const low = item({ id: "low", name: "Brake pads", stockStatus: "low_stock", quantity: 2, minQuantity: 5 });
    const out = item({ id: "out", name: "Oil filter", stockStatus: "out_of_stock", quantity: 0, minQuantity: 1, sku: "OF-1" });

    renderWithQuery(
      <StockAttentionPanel items={[low, out]} activeFilter="all" onFilter={onFilter} onOpenItem={onOpenItem} />,
    );

    expect(screen.getByText("Stock needing attention")).toBeInTheDocument();
    expect(screen.getByText(/Order material requests do not change stock/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 items out of stock/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 items low on stock/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /1 items out of stock/i }));
    expect(onFilter).toHaveBeenCalledWith("out_of_stock");

    await user.click(screen.getByRole("button", { name: /Oil filter/i }));
    expect(onOpenItem).toHaveBeenCalledWith(out);
  });

  it("shows loading and error states", () => {
    const { rerender } = renderWithQuery(
      <StockAttentionPanel items={[]} isLoading activeFilter="all" onFilter={vi.fn()} onOpenItem={vi.fn()} />,
    );
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();

    rerender(
      <StockAttentionPanel
        items={[]}
        isError
        activeFilter="all"
        onFilter={vi.fn()}
        onOpenItem={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("Could not load stock attention")).toBeInTheDocument();
  });
});
