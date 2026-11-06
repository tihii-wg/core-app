import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryItem } from "../../lib/types";
import type { InventoryItemDeletePreview } from "../../services/apiInventory";
import { MissingRpcError } from "../../services/missingRpc";
import { DeleteInventoryItemDialog } from "./DeleteInventoryItemDialog";

const previewMutate = vi.hoisted(() => ({
  data: null as InventoryItemDeletePreview | null,
  error: null as Error | null,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

const purgeMutate = vi.hoisted(() => vi.fn());
const deleteMutate = vi.hoisted(() => vi.fn());
const updateMutate = vi.hoisted(() => vi.fn());

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryInventoryCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow("auto_repair");
      return { workflow, inventoryCopy: industryInventoryCopy(workflow) };
    },
  };
});

vi.mock("./useInventoryItemDeletePreview", () => ({
  useInventoryItemDeletePreview: () => ({
    data: previewMutate.data,
    error: previewMutate.error,
    isLoading: previewMutate.isLoading,
    isError: previewMutate.isError || Boolean(previewMutate.error),
    refetch: previewMutate.refetch,
  }),
}));

vi.mock("./usePurgeInventoryItem", () => ({
  usePurgeInventoryItem: () => ({
    mutate: purgeMutate,
    isPending: false,
  }),
}));

vi.mock("./useDeleteInventoryItem", () => ({
  useDeleteInventoryItem: () => ({
    mutate: deleteMutate,
    isPending: false,
  }),
}));

vi.mock("./useUpdateInventoryItem", () => ({
  useUpdateInventoryItem: () => ({
    mutate: updateMutate,
    isPending: false,
  }),
}));

vi.mock("../orders/useOrderDetails", () => ({
  useOrderDetails: () => ({
    openOrder: vi.fn(),
    panelProps: {
      selectedOrder: null,
      detailPanelOpen: false,
      setDetailPanelOpen: vi.fn(),
      onOrderUpdated: vi.fn(),
      onStatusChange: vi.fn(),
      isStatusUpdating: false,
    },
  }),
}));

vi.mock("../../services/apiOrders", () => ({
  getOrder: vi.fn(),
}));

const item: InventoryItem = {
  id: "item-1",
  workspaceId: "ws-1",
  name: "Brake pads",
  sku: "BP-1",
  description: "",
  category: "Brakes",
  quantity: 2,
  minQuantity: 1,
  unit: "pcs",
  purchasePrice: 10,
  sellingPrice: 25,
  supplier: "Acme",
  location: "",
  isActive: true,
  stockStatus: "in_stock",
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
};

function basePreview(overrides: Partial<InventoryItemDeletePreview> = {}): InventoryItemDeletePreview {
  return {
    itemId: "item-1",
    itemName: "Brake pads",
    isOwner: true,
    canDelete: true,
    blockingOrders: [],
    cancelledOrdersCount: 0,
    stockQuantity: 2,
    movementsCount: 3,
    stockRowsCount: 1,
    batchesCount: 0,
    serialsCount: 0,
    reservationsCount: 0,
    draftDocumentLinesCount: 1,
    postedDocumentLinesCount: 0,
    ...overrides,
  };
}

function renderDialog(onDeleted = vi.fn(), onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  const ui: ReactElement = <DeleteInventoryItemDialog item={item} onClose={onClose} onDeleted={onDeleted} />;
  render(ui, { wrapper: Wrapper });
  return { onDeleted, onClose };
}

describe("DeleteInventoryItemDialog", () => {
  beforeEach(() => {
    previewMutate.data = null;
    previewMutate.error = null;
    previewMutate.isLoading = false;
    previewMutate.isError = false;
    previewMutate.refetch.mockReset();
    purgeMutate.mockReset();
    deleteMutate.mockReset();
    updateMutate.mockReset();
  });

  it("lists blocking orders, disables permanent delete, and offers mark inactive", async () => {
    previewMutate.data = basePreview({
      canDelete: false,
      blockingOrders: [{ orderId: "o1", number: "ORD-100", status: "in-progress" }],
    });
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/used in orders/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "ORD-100" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /delete permanently/i })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /mark inactive/i })).toBeEnabled();
  });

  it("shows owner-only message for non-owners", async () => {
    previewMutate.data = basePreview({ isOwner: false, canDelete: false });
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/only the workspace owner can fully delete/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /mark inactive/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /delete permanently/i })).not.toBeInTheDocument();
  });

  it("requires the irreversible checkbox before calling purge and onDeleted", async () => {
    const user = userEvent.setup();
    previewMutate.data = basePreview();
    purgeMutate.mockImplementation((_id: string, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });
    const { onDeleted, onClose } = renderDialog();

    const dialog = await screen.findByRole("dialog");
    const deleteButton = within(dialog).getByRole("button", { name: /delete permanently/i });
    expect(deleteButton).toBeDisabled();

    await user.click(within(dialog).getByRole("checkbox"));
    expect(deleteButton).toBeEnabled();

    await user.click(deleteButton);
    expect(purgeMutate).toHaveBeenCalledTimes(1);
    expect(purgeMutate).toHaveBeenCalledWith("item-1", expect.any(Object));
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith("item-1");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("refetches the preview after a used_in_orders purge error", async () => {
    const user = userEvent.setup();
    previewMutate.data = basePreview();
    purgeMutate.mockImplementation((_id: string, options?: { onError?: (error: Error) => void }) => {
      options?.onError?.(new Error("This part is used in orders: ORD-1. Cancel those orders first."));
    });
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: /delete permanently/i }));

    expect(previewMutate.refetch).toHaveBeenCalled();
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it("falls back to the legacy delete flow when the preview RPC is missing", async () => {
    const user = userEvent.setup();
    previewMutate.error = new MissingRpcError("crm_inventory_item_delete_preview", "missing");
    previewMutate.isError = true;
    deleteMutate.mockImplementation((_id: string, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });
    const { onDeleted, onClose } = renderDialog();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Brake pads")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    expect(deleteMutate).toHaveBeenCalledWith("item-1", expect.any(Object));
    expect(purgeMutate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith("item-1");
      expect(onClose).toHaveBeenCalled();
    });
  });
});
