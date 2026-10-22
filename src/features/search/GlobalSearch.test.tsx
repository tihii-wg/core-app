import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import GlobalSearch from "./GlobalSearch";

vi.mock("./useGlobalSearch", () => ({
  MIN_SEARCH_LENGTH: 2,
  useGlobalSearch: () => ({
    term: "",
    isSearching: false,
    orders: { results: [], isError: false },
    clients: { results: [], isError: false },
    inventory: { results: [], isError: false },
  }),
}));

vi.mock("../orders/useOrderDetails", () => ({
  useOrderDetails: () => ({ openOrder: vi.fn(), panelProps: { selectedOrder: null } }),
}));
vi.mock("../orders/useGetOrders", () => ({
  useGetOrders: () => ({ orders: [] }),
}));
vi.mock("../orders/OrderDetailPanel", () => ({ default: () => null }));
vi.mock("../clients/ClientDetailPanel", () => ({ default: () => null }));
vi.mock("../inventory/InventoryDetailPanel", () => ({ default: () => null }));
vi.mock("../inventory/EditInventoryItemDialog", () => ({ EditInventoryItemDialog: () => null }));
vi.mock("../inventory/DeleteInventoryItemDialog", () => ({ DeleteInventoryItemDialog: () => null }));
vi.mock("../inventory/useGetInventoryItem", () => ({
  useGetInventoryItem: () => ({ item: null, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("../industries/useIndustryWorkflow", async () => {
  const actual = await vi.importActual<typeof import("../industries/industryWorkflow")>("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = actual.industryWorkflow("auto_repair");
      return {
        workflow,
        shell: actual.industryShellCopy(workflow),
        copy: actual.industryOrderCopy(workflow),
        industrySlug: "auto_repair",
        industryId: null,
        isLoading: false,
        error: null,
      };
    },
  };
});

describe("GlobalSearch mobile entry point", () => {
  it("exposes a search toggle button (visible below the md breakpoint) that opens the search input", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);

    const toggle = screen.getByRole("button", { name: /search/i });
    expect(toggle.className).toContain("md:hidden");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The single shared combobox input becomes available for typing.
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});
