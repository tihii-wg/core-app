import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryItem } from "../../lib/types";
import type { SupplierDelivery } from "../../services/apiWarehouseOps";
import { renderWithQuery } from "../../tests/renderQuery";
import { SupplierPage } from "./SupplierPage";

const deliveriesState = vi.hoisted(() => ({
  rows: [] as SupplierDelivery[],
  totalCount: 0,
  postedTotal: 0,
  lastDeliveryAt: null as string | null,
  isLoading: false,
  isError: false,
}));

const partsState = vi.hoisted(() => ({
  parts: [] as InventoryItem[],
  isLoading: false,
  isError: false,
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useParams: () => ({ locale: "en", workspaceId: "ws-1", supplierName: encodeURIComponent("Acme Parts") }),
    useNavigate: () => vi.fn(),
  };
});

const returnsState = vi.hoisted(() => ({
  returns: [] as import("../../services/apiWarehouseOps").SupplierReturnRecord[],
  isLoading: false,
  isError: false,
}));

vi.mock("./useSupplierDeliveries", () => ({
  useSupplierDeliveries: () => ({
    data: {
      pages: [
        {
          rows: deliveriesState.rows,
          page: 1,
          pageSize: 50,
          hasMore: deliveriesState.totalCount > deliveriesState.rows.length,
          totalCount: deliveriesState.totalCount,
          postedTotal: deliveriesState.postedTotal,
          lastDeliveryAt: deliveriesState.lastDeliveryAt,
        },
      ],
    },
    isLoading: deliveriesState.isLoading,
    isError: deliveriesState.isError,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useSupplierParts: () => ({
    data: partsState.parts,
    isLoading: partsState.isLoading,
    isError: partsState.isError,
    refetch: vi.fn(),
  }),
  useSupplierReturns: () => ({
    data: returnsState.returns,
    isLoading: returnsState.isLoading,
    isError: returnsState.isError,
    refetch: vi.fn(),
  }),
}));

vi.mock("../inventory/useWarehouseOps", () => ({
  useReturnedQuantitiesForReceipt: () => ({ data: new Map([["i1", 1]]), isLoading: false }),
  useCreateAndPostSupplierReturn: () => ({ mutate: vi.fn(), isPending: false }),
  useRecordSupplierReturnRefund: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../finance/useFinanceAccounts", () => ({
  useFinanceAccounts: () => ({
    data: [{ id: "acc-1", name: "Cash", isActive: true, currencyCode: "MDL" }],
    isLoading: false,
  }),
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({ canWrite: true }),
}));

const permissionsState = vi.hoisted(() => ({
  allowReturn: true,
}));

vi.mock("../roles/useMyPermissions", () => ({
  useMyPermissions: () => ({
    can: (key: string) => (key === "inventory.supplier_returns.create" ? permissionsState.allowReturn : true),
  }),
}));

vi.mock("../warehouses/useGetWarehouses", () => ({
  useGetWarehouses: () => ({
    data: [{ id: "wh-1", name: "Main warehouse" }],
  }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({
    currency: "MDL",
    formatMoney: (value: number) => `MDL ${value.toFixed(2)}`,
  }),
}));

vi.mock("../reports/reportFormatting", () => ({
  useReportFormatting: () => ({ formatDate: (value: string) => (value ? `D:${value}` : "—") }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1", isLoading: false, error: null }),
}));

vi.mock("../../hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("../inventory/useGetInventoryItem", () => ({
  useGetInventoryItem: () => ({ item: null, isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock("../inventory/InventoryDetailPanel", () => ({ default: () => null }));
vi.mock("../inventory/EditInventoryItemDialog", () => ({ EditInventoryItemDialog: () => null }));
vi.mock("../inventory/DeleteInventoryItemDialog", () => ({ DeleteInventoryItemDialog: () => null }));

const delivery: SupplierDelivery = {
  id: "r1",
  workspaceId: "ws-1",
  kind: "receipt",
  warehouseId: "wh-1",
  number: "GR-100",
  comment: "Morning delivery",
  total: 42,
  createdAt: "2026-11-05T10:00:00Z",
  receivedAt: "2026-11-05T10:00:00Z",
  status: "posted",
  posted: true,
  supplierName: "Acme Parts",
  matchedByLegacy: false,
  lines: [
    {
      id: "l1",
      inventoryItemId: "i1",
      itemName: "Brake pads",
      itemSku: "BP-1",
      quantity: 2,
      unitCost: 21,
      amount: 42,
    },
  ],
};

describe("SupplierPage", () => {
  beforeEach(() => {
    deliveriesState.rows = [];
    deliveriesState.totalCount = 0;
    deliveriesState.postedTotal = 0;
    deliveriesState.lastDeliveryAt = null;
    deliveriesState.isLoading = false;
    deliveriesState.isError = false;
    partsState.parts = [];
    partsState.isLoading = false;
    partsState.isError = false;
    returnsState.returns = [];
    returnsState.isLoading = false;
    returnsState.isError = false;
    permissionsState.allowReturn = true;
  });

  it("shows empty state when there are no deliveries", () => {
    renderWithQuery(<SupplierPage />);
    expect(screen.getByText("No deliveries from this supplier yet")).toBeInTheDocument();
    expect(screen.getByText("Deliveries: 0")).toBeInTheDocument();
  });

  it("shows summary totalCount from the first page even when more rows exist than loaded", () => {
    deliveriesState.rows = [delivery];
    deliveriesState.totalCount = 75;
    deliveriesState.postedTotal = 420;
    deliveriesState.lastDeliveryAt = "2026-11-05T10:00:00Z";
    renderWithQuery(<SupplierPage />);
    expect(screen.getByText("Deliveries: 75")).toBeInTheDocument();
    expect(screen.getByText("MDL 420.00")).toBeInTheDocument();
    expect(screen.getAllByText("D:2026-11-05").length).toBeGreaterThanOrEqual(1);
  });

  it("renders summary, deliveries list, and opens delivery detail with lines", async () => {
    const user = userEvent.setup();
    deliveriesState.rows = [delivery];
    deliveriesState.totalCount = 1;
    deliveriesState.postedTotal = 42;
    deliveriesState.lastDeliveryAt = "2026-11-05T10:00:00Z";
    partsState.parts = [
      {
        id: "i1",
        workspaceId: "ws-1",
        name: "Brake pads",
        sku: "BP-1",
        description: "",
        category: "",
        quantity: 2,
        minQuantity: 1,
        unit: "pcs",
        purchasePrice: 21,
        sellingPrice: null,
        supplier: "Acme Parts",
        location: "",
        isActive: true,
        stockStatus: "in_stock",
        createdAt: "",
        updatedAt: "",
      },
    ];

    renderWithQuery(<SupplierPage />);

    expect(screen.getByRole("heading", { name: "Acme Parts" })).toBeInTheDocument();
    expect(screen.getByText("Deliveries: 1")).toBeInTheDocument();
    expect(screen.getByText("Parts: 1")).toBeInTheDocument();
    expect(screen.getByText(/Deliveries total/)).toBeInTheDocument();
    expect(screen.getAllByText("MDL 42.00").length).toBeGreaterThanOrEqual(1);

    const table = screen.getByRole("table");
    expect(within(table).getByText("GR-100")).toBeInTheDocument();
    expect(within(table).getByText("Main warehouse")).toBeInTheDocument();

    await user.click(within(table).getByText("GR-100"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Delivery GR-100" })).toBeInTheDocument();
    expect(within(dialog).getByText("Brake pads")).toBeInTheDocument();
    expect(within(dialog).getByText("BP-1")).toBeInTheDocument();
    expect(within(dialog).getByText(/Returned: 1/)).toBeInTheDocument();
    expect(within(dialog).getByText("Morning delivery")).toBeInTheDocument();
    expect(within(dialog).getAllByText("Acme Parts").length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "Return to supplier" })).toBeInTheDocument();
  });

  it("hides Return to supplier without inventory.supplier_returns.create", async () => {
    const user = userEvent.setup();
    permissionsState.allowReturn = false;
    deliveriesState.rows = [delivery];
    deliveriesState.totalCount = 1;
    deliveriesState.postedTotal = 42;
    deliveriesState.lastDeliveryAt = "2026-11-05T10:00:00Z";
    renderWithQuery(<SupplierPage />);
    await user.click(screen.getByText("GR-100"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Return to supplier" })).not.toBeInTheDocument();
  });

  it("shows name, sku and description on the parts tab", async () => {
    const user = userEvent.setup();
    partsState.parts = [
      {
        id: "i1",
        workspaceId: "ws-1",
        name: "Brake pads ceramic",
        sku: "BP-CER",
        description: "Front axle ceramic pads",
        category: "Brakes",
        quantity: 2,
        minQuantity: 1,
        unit: "pcs",
        purchasePrice: 21,
        sellingPrice: null,
        supplier: "Acme Parts",
        location: "",
        isActive: true,
        stockStatus: "in_stock",
        createdAt: "",
        updatedAt: "",
      },
    ];
    renderWithQuery(<SupplierPage />);
    await user.click(screen.getByRole("button", { name: "Supplier parts" }));
    expect(screen.getByText("Brake pads ceramic")).toBeInTheDocument();
    expect(screen.getByText("BP-CER")).toBeInTheDocument();
    expect(screen.getByText("Front axle ceramic pads")).toBeInTheDocument();
  });

  it("renders the Returns tab list with record-money action and refund badge", async () => {
    const user = userEvent.setup();
    returnsState.returns = [
      {
        id: "sr1",
        workspaceId: "ws-1",
        kind: "supplierReturn",
        warehouseId: "wh-1",
        goodsReceiptId: "r1",
        number: "SR-1",
        comment: "",
        total: 21,
        createdAt: "2026-11-06T10:00:00Z",
        postedAt: "2026-11-06T10:00:00Z",
        posted: true,
        supplierName: "Acme Parts",
        reason: "Defective",
        refundAccountId: null,
        financeTransactionId: null,
        lines: [
          {
            id: "l1",
            inventoryItemId: "i1",
            itemName: "Brake pads",
            itemSku: "BP-1",
            quantity: 1,
            unitCost: 21,
            amount: 21,
          },
        ],
      },
      {
        id: "sr2",
        workspaceId: "ws-1",
        kind: "supplierReturn",
        warehouseId: "wh-1",
        goodsReceiptId: "r1",
        number: "SR-2",
        comment: "",
        total: 10,
        createdAt: "2026-11-06T11:00:00Z",
        postedAt: "2026-11-06T11:00:00Z",
        posted: true,
        supplierName: "Acme Parts",
        reason: "Wrong item",
        refundAccountId: "acc-1",
        financeTransactionId: "ft-1",
        lines: [],
      },
    ];
    renderWithQuery(<SupplierPage />);
    await user.click(screen.getByRole("button", { name: "Returns" }));
    expect(screen.getByText("SR-1")).toBeInTheDocument();
    expect(screen.getAllByText("Main warehouse").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /Record money back/i })).toBeInTheDocument();
    expect(screen.getByText(/Refunded MDL 10\.00 → Cash/i)).toBeInTheDocument();
  });
});
