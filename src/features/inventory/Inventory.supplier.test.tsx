import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { InventoryItem } from "../../lib/types";
import { Inventory } from "./Inventory";

const fixtures = vi.hoisted(() => {
  const base = {
    workspaceId: "ws-1",
    description: "",
    category: "Parts",
    unit: "pcs",
    purchasePrice: null,
    sellingPrice: null,
    location: "",
    isActive: true,
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
  };
  const items: InventoryItem[] = [
    { ...base, id: "1", name: "Brake pads", sku: "BP-1", quantity: 2, minQuantity: 5, supplier: "Acme", stockStatus: "low_stock" },
    { ...base, id: "2", name: "Oil filter", sku: "OF-1", quantity: 20, minQuantity: 5, supplier: "Acme", stockStatus: "in_stock" },
    { ...base, id: "3", name: "Chain lube", sku: "CL-1", quantity: 1, minQuantity: 5, supplier: "Beta", stockStatus: "low_stock" },
    { ...base, id: "4", name: "Shop towel", sku: "ST-1", quantity: 9, minQuantity: 2, supplier: "", stockStatus: "in_stock" },
  ];
  return { items };
});

vi.mock("./useGetInventoryItems", () => ({
  useGetInventoryItems: (
    search: string,
    filter: string,
    _sort: unknown,
    options?: { supplier?: string },
  ) => {
    let items = fixtures.items;
    const term = search.trim().toLowerCase();
    if (term) items = items.filter((item) => item.name.toLowerCase().includes(term));
    if (filter === "low_stock") items = items.filter((item) => item.stockStatus === "low_stock");
    if (filter === "in_stock") items = items.filter((item) => item.stockStatus === "in_stock");
    const supplier = options?.supplier ?? "all";
    if (supplier !== "all") items = items.filter((item) => item.supplier === supplier);
    return { items, isLoading: false, isError: false, refetch: vi.fn() };
  },
}));

vi.mock("./useGetInventorySuppliers", () => ({
  useGetInventorySuppliers: () => ({ suppliers: ["Acme", "Beta"], isLoading: false, isError: false }),
}));

vi.mock("./useGetInventoryItem", () => ({
  useGetInventoryItem: () => ({ item: null, isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({ data: { currency: "MDL" } }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => ({
      workflow: industryWorkflow("auto_repair"),
      industrySlug: "auto_repair",
      industryId: null,
      isLoading: false,
      error: null,
    }),
  };
});

vi.mock("./StockAttentionPanel", () => ({ StockAttentionPanel: () => null }));
vi.mock("./AddInventoryItemDialog", () => ({ AddInventoryItemDialog: () => null }));
vi.mock("./EditInventoryItemDialog", () => ({ EditInventoryItemDialog: () => null }));
vi.mock("./DeleteInventoryItemDialog", () => ({ DeleteInventoryItemDialog: () => null }));
vi.mock("./InventoryDetailPanel", () => ({ default: () => null }));

function renderPage() {
  return render(
    <MemoryRouter>
      <Inventory />
    </MemoryRouter>,
  );
}

describe("Inventory supplier column and filter", () => {
  it("shows a Supplier column immediately after SKU, with — for missing suppliers", () => {
    renderPage();

    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers.indexOf("Supplier")).toBe(headers.indexOf("SKU") + 1);

    const table = screen.getByRole("table");
    expect(within(table).getAllByText("Acme")).toHaveLength(2);
    expect(within(table).getByText("Beta")).toBeInTheDocument();

    const towelRow = within(table).getByText("Shop towel").closest("tr");
    expect(towelRow?.textContent).toContain("—");
  });

  it("filters by supplier and restores the full list with All suppliers", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("combobox", { name: "Supplier" }));
    await user.click(await screen.findByRole("option", { name: "Acme" }));

    expect(screen.getByText("Brake pads")).toBeInTheDocument();
    expect(screen.getByText("Oil filter")).toBeInTheDocument();
    expect(screen.queryByText("Chain lube")).not.toBeInTheDocument();
    expect(screen.queryByText("Shop towel")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Supplier" }));
    await user.click(await screen.findByRole("option", { name: "All suppliers" }));

    expect(screen.getByText("Chain lube")).toBeInTheDocument();
    expect(screen.getByText("Shop towel")).toBeInTheDocument();
  });

  it("combines the supplier filter with the stock-status filter", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("combobox", { name: "Supplier" }));
    await user.click(await screen.findByRole("option", { name: "Acme" }));
    await user.click(screen.getByRole("combobox", { name: "Stock" }));
    await user.click(await screen.findByRole("option", { name: "Low Stock" }));

    expect(screen.getByText("Brake pads")).toBeInTheDocument();
    expect(screen.queryByText("Oil filter")).not.toBeInTheDocument();
    expect(screen.queryByText("Chain lube")).not.toBeInTheDocument();
  });

  it("renders item cards instead of the table on a phone viewport", async () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });

    renderPage();

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(await screen.findByText("Brake pads")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions for Brake pads" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Supplier" })).toBeInTheDocument();
  });
});
