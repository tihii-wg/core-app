import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoodsReceiptRecord } from "../../services/apiWarehouseOps";
import { renderWithQuery } from "../../tests/renderQuery";
import { SupplierReturnDialog } from "./SupplierReturnDialog";

const mutate = vi.hoisted(() => vi.fn());
const removeCatalog = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const previewState = vi.hoisted(() => ({
  data: {
    itemId: "i1",
    itemName: "Oil filter",
    isOwner: true,
    canDelete: true,
    blockingOrders: [] as { orderId: string; number: string; status: string }[],
    cancelledOrdersCount: 0,
    stockQuantity: 4,
    movementsCount: 1,
    stockRowsCount: 1,
    batchesCount: 1,
    serialsCount: 0,
    reservationsCount: 0,
    draftDocumentLinesCount: 0,
    postedDocumentLinesCount: 1,
  } as {
    itemId: string;
    itemName: string;
    isOwner: boolean;
    canDelete: boolean;
    blockingOrders: { orderId: string; number: string; status: string }[];
    cancelledOrdersCount: number;
    stockQuantity: number;
    movementsCount: number;
    stockRowsCount: number;
    batchesCount: number;
    serialsCount: number;
    reservationsCount: number;
    draftDocumentLinesCount: number;
    postedDocumentLinesCount: number;
  } | null,
  error: null as Error | null,
}));

vi.mock("./useWarehouseOps", () => ({
  useCreateAndPostSupplierReturn: () => ({ mutate, isPending: false }),
  useReturnedQuantitiesForReceipt: () => ({ data: new Map([["i1", 1]]), isLoading: false }),
}));

vi.mock("./supplierReturnCatalogRemoval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./supplierReturnCatalogRemoval")>();
  return {
    ...actual,
    removeCatalogItemsAfterReturn: (...args: unknown[]) => removeCatalog(...args),
  };
});

vi.mock("react-hot-toast", () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    loading: vi.fn(),
  },
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({
    currency: "MDL",
    formatMoney: (value: number) => `MDL ${value.toFixed(2)}`,
  }),
}));

vi.mock("../roles/useMyPermissions", () => ({
  useMyPermissions: () => ({ can: () => true }),
}));

vi.mock("../finance/useFinanceAccounts", () => ({
  useFinanceAccounts: () => ({ data: [], isLoading: false }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueries: () => [
      {
        data: previewState.data ?? undefined,
        error: previewState.error,
        isLoading: false,
        isError: Boolean(previewState.error),
      },
    ],
  };
});

const receipt: GoodsReceiptRecord = {
  id: "r1",
  workspaceId: "ws-1",
  kind: "receipt",
  warehouseId: "wh-1",
  number: "GR-1",
  comment: "",
  total: 50,
  createdAt: "2026-11-05T00:00:00Z",
  receivedAt: "2026-11-05T00:00:00Z",
  status: "posted",
  posted: true,
  supplierName: "Acme",
  lines: [
    {
      id: "l1",
      inventoryItemId: "i1",
      itemName: "Oil filter",
      itemSku: "OF-1",
      quantity: 5,
      unitCost: 10,
      amount: 50,
    },
  ],
};

describe("SupplierReturnDialog catalog removal", () => {
  beforeEach(() => {
    mutate.mockReset();
    mutate.mockImplementation((_input: unknown, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });
    removeCatalog.mockReset();
    removeCatalog.mockResolvedValue({ removedCount: 1, failures: [] });
    toastSuccess.mockReset();
    toastError.mockReset();
    previewState.data = {
      itemId: "i1",
      itemName: "Oil filter",
      isOwner: true,
      canDelete: true,
      blockingOrders: [],
      cancelledOrdersCount: 0,
      stockQuantity: 4,
      movementsCount: 1,
      stockRowsCount: 1,
      batchesCount: 1,
      serialsCount: 0,
      reservationsCount: 0,
      draftDocumentLinesCount: 0,
      postedDocumentLinesCount: 1,
    };
    previewState.error = null;
  });

  it("shows the remove-from-catalog checkbox checked by default for a full return to zero", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <SupplierReturnDialog open receipt={receipt} warehouseName="Main" onOpenChange={vi.fn()} />,
    );

    const qty = screen.getByLabelText(/Return qty/i);
    await user.clear(qty);
    await user.type(qty, "4");

    const checkbox = await screen.findByRole("checkbox", { name: /Remove part from catalog/i });
    expect(checkbox).toBeChecked();
    expect(screen.getByText(/Stock will be 0/i)).toBeInTheDocument();
  });

  it("does not show the checkbox for a partial return", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <SupplierReturnDialog open receipt={receipt} warehouseName="Main" onOpenChange={vi.fn()} />,
    );

    const qty = screen.getByLabelText(/Return qty/i);
    await user.clear(qty);
    await user.type(qty, "2");

    expect(screen.queryByRole("checkbox", { name: /Remove part from catalog/i })).not.toBeInTheDocument();
  });

  it("purges checked owner items after a successful post", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithQuery(
      <SupplierReturnDialog open receipt={receipt} warehouseName="Main" onOpenChange={onOpenChange} />,
    );

    await user.type(screen.getByLabelText(/Return reason/i), "Wrong item");
    const qty = screen.getByLabelText(/Return qty/i);
    await user.clear(qty);
    await user.type(qty, "4");
    await screen.findByRole("checkbox", { name: /Remove part from catalog/i });

    await user.click(screen.getByRole("button", { name: "Post return" }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    await waitFor(() =>
      expect(removeCatalog).toHaveBeenCalledWith(
        [{ inventoryItemId: "i1", itemName: "Oil filter", isOwner: true }],
        "ws-1",
      ),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("deactivates for non-owners", async () => {
    previewState.data = { ...previewState.data!, isOwner: false };
    const user = userEvent.setup();
    renderWithQuery(
      <SupplierReturnDialog open receipt={receipt} warehouseName="Main" onOpenChange={vi.fn()} />,
    );

    await user.type(screen.getByLabelText(/Return reason/i), "Wrong item");
    const qty = screen.getByLabelText(/Return qty/i);
    await user.clear(qty);
    await user.type(qty, "4");

    const checkbox = await screen.findByRole("checkbox", { name: /Remove part from catalog/i });
    expect(checkbox).toBeDisabled();
    expect(screen.getByText(/Only the owner can delete/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Post return" }));
    await waitFor(() =>
      expect(removeCatalog).toHaveBeenCalledWith(
        [{ inventoryItemId: "i1", itemName: "Oil filter", isOwner: false }],
        "ws-1",
      ),
    );
  });

  it("keeps the return posted and shows an error toast when purge fails", async () => {
    removeCatalog.mockResolvedValue({
      removedCount: 0,
      failures: [{ itemName: "Oil filter", message: "in use" }],
    });
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithQuery(
      <SupplierReturnDialog open receipt={receipt} warehouseName="Main" onOpenChange={onOpenChange} />,
    );

    await user.type(screen.getByLabelText(/Return reason/i), "Wrong item");
    const qty = screen.getByLabelText(/Return qty/i);
    await user.clear(qty);
    await user.type(qty, "4");
    await screen.findByRole("checkbox", { name: /Remove part from catalog/i });
    await user.click(screen.getByRole("button", { name: "Post return" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
