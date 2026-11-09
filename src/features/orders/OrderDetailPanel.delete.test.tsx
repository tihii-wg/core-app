import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import type { Order } from "../../lib/types";
import type { LedgerPayment } from "../finance/paymentTypes";
import OrderDetailPanel from "./OrderDetailPanel";

const mutateAsync = vi.hoisted(() => vi.fn());
const deletePending = vi.hoisted(() => ({ value: false }));
const paymentsState = vi.hoisted(() => ({ payments: [] as LedgerPayment[] }));
const subscriptionState = vi.hoisted(() => ({ canWrite: true }));

vi.mock("./useDeleteOrder", () => ({
  useDeleteOrder: () => ({
    mutateAsync,
    isPending: deletePending.value,
  }),
}));

vi.mock("./useUpdateOrder", () => ({
  useUpdateOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("./useGetOrders", () => ({
  useGetOrders: () => ({ orders: [], isLoading: false, error: null }),
  useUpdateOrderTaxInvoiceNumber: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateOrderStatus: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
}));

vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({
    data: { currency: "MDL", requireTaxInvoiceNumber: false, subscriptionStatus: "active" },
    isLoading: false,
    error: null,
    isFetched: true,
  }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
  useGetProfile: () => ({ data: { id: "user-1" }, isLoading: false }),
}));

vi.mock("../workspaces/useIsWorkspaceOwnerId", () => ({
  useIsWorkspaceOwnerId: () => true,
}));

vi.mock("../employees/useGetEmployees", () => ({
  default: () => ({ employees: [], error: null, isLoading: false }),
}));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => "owner",
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({
    canWrite: subscriptionState.canWrite,
    isEntitlementPending: false,
  }),
  useGuardSubscriptionWrite: () => vi.fn(),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (value: number) => `MDL ${value.toFixed(2)}` }),
}));

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow("auto_repair");
      return { workflow, copy: industryOrderCopy(workflow), industrySlug: "auto_repair", industryId: null, isLoading: false, error: null };
    },
  };
});

vi.mock("../statuses/useGetStatusDefinitions", () => ({
  useGetStatusDefinitions: () => ({ data: [], isLoading: false, error: null }),
}));

vi.mock("./useMoveOrderOnBoard", () => ({
  useMoveOrderOnBoard: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("./useCloseOrder", () => ({
  useCloseOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useCancelOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("./useClosedOrderPermissions", () => ({
  useClosedOrderActionPermissions: () => ({
    role: "owner",
    grants: { cancelClosed: [], deleteClosed: [] },
    isLoading: false,
    isError: false,
    canCancelClosed: true,
    canDeleteClosed: true,
    canManageClosedContent: false,
    isOwnerByOwnerId: true,
    ownerCanManageClosedOrders: false,
  }),
  useClosedOrderPermissionGrants: () => ({ data: { cancelClosed: [], deleteClosed: [] }, isLoading: false }),
}));

vi.mock("../finance/useFinanceAccounts", () => ({
  useFinanceAccounts: () => ({ data: [], isLoading: false }),
}));

vi.mock("./OrderAttachmentsSection", () => ({
  default: () => <div data-testid="order-attachments-stub" />,
}));

vi.mock("./OrderFeedSection", () => ({
  default: () => <div data-testid="order-feed-stub" />,
}));

vi.mock("./useOrderFeed", () => ({
  useGetOrderComments: () => ({ comments: [], isUnavailable: false, isLoading: false, isError: false }),
  useGetOrderEvents: () => ({ events: [], isUnavailable: false, isLoading: false, isError: false }),
  useCreateOrderComment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteOrderComment: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../finance/usePayments", () => ({
  useGetPayments: () => ({
    payments: paymentsState.payments,
    isLoading: false,
    error: null,
    isUnavailable: false,
    refetch: vi.fn(),
  }),
  useRecordPayment: () => ({ mutate: vi.fn(), isPending: false }),
  useRecordRefund: () => ({ mutate: vi.fn(), isPending: false }),
  useRecordPaymentVoid: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteFullyVoidedPayment: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../vehicles/useGetClientVehicles", () => ({
  useGetClientVehicles: () => ({ vehicles: [], isLoading: false, isError: false }),
  clientVehiclesQueryKey: () => ["vehicles"],
}));

vi.mock("../vehicles/useGetVehicle", () => ({
  useGetVehicle: () => ({
    vehicle: null,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    notFound: false,
    refetch: vi.fn(),
  }),
  vehicleQueryKey: () => ["vehicles", "id"],
}));

vi.mock("../vehicles/useVehicleMutations", () => ({
  useCreateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const order = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Ada Lovelace",
  clientEmail: "ada@example.com",
  clientPhone: "+37361111111",
  orderNumber: "ORD-2026-003",
  device: "",
  vin: "",
  carNumber: "",
  service: "Oil change",
  services: [{ id: "line-1", serviceId: "svc-oil", serviceName: "Oil change", price: 40, quantity: 1 }],
  materials: [],
  description: "",
  status: "cancelled",
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "2026-10-01",
  totalPrice: 40,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "2026-09-26",
  updatedAt: "2026-09-26",
} as Order;

function renderPanel(props: {
  selectedOrder?: Order;
  invoiceNumber?: string;
  onDeleted?: (orderId: string) => void;
  setDetailPanelOpen?: (open: boolean) => void;
} = {}) {
  return renderWithQuery(
    <OrderDetailPanel
      selectedOrder={props.selectedOrder ?? order}
      detailPanelOpen
      setDetailPanelOpen={props.setDetailPanelOpen ?? vi.fn()}
      onOrderUpdated={vi.fn()}
      onStatusChange={vi.fn()}
      invoiceNumber={props.invoiceNumber}
      onDeleted={props.onDeleted}
    />,
  );
}

describe("OrderDetailPanel delete action", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({
      id: "order-1",
      paymentsDeleted: 0,
      materialsReturned: [],
      attachmentStoragePaths: [],
      storageCleanupComplete: true,
    });
    deletePending.value = false;
    paymentsState.payments = [];
    subscriptionState.canWrite = true;
  });

  it("opens a confirmation dialog and cancels without deleting", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    renderPanel({ onDeleted });

    await user.click(screen.getByRole("button", { name: /Delete order/i }));
    expect(screen.getByRole("heading", { name: /Delete order permanently/i })).toBeInTheDocument();
    expect(screen.getByText(/This cannot be undone/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /Delete order permanently/i })).not.toBeInTheDocument();
    });
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("deletes the cancelled order and notifies the parent on confirm", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    renderPanel({ onDeleted });

    await user.click(screen.getByRole("button", { name: /Delete order/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^Delete order$/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith("order-1");
    });
    expect(onDeleted).toHaveBeenCalledWith("order-1");
  });

  it("refuses delete when the order is not cancelled", async () => {
    renderPanel({ selectedOrder: { ...order, status: "new" } });
    const deleteButton = screen.getByRole("button", { name: /Delete order/i });
    expect(deleteButton).toBeDisabled();
    expect(screen.getByText(/Cancel the order first/i)).toBeInTheDocument();
  });

  it("blocks delete when active payments remain", async () => {
    paymentsState.payments = [
      {
        id: "p1",
        workspaceId: "ws-1",
        orderId: "order-1",
        invoiceId: null,
        relatedPaymentId: null,
        amount: 10,
        kind: "payment",
        currencyCode: "MDL",
        paymentMethod: "cash",
        paidAt: "2026-11-01",
        note: "",
        createdBy: null,
        createdAt: "2026-11-01",
      },
    ];
    renderPanel();
    const deleteButton = screen.getByRole("button", { name: /Delete order/i });
    expect(deleteButton).toBeDisabled();
    expect(screen.getByText(/active payments/i)).toBeInTheDocument();
  });

  it("keeps invoice-linked orders intact and does not call delete", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    renderPanel({ invoiceNumber: "INV-1", onDeleted });

    const deleteButton = screen.getByRole("button", { name: /Delete order/i });
    expect(deleteButton).toBeDisabled();
    expect(screen.getByText(/invoice/i)).toBeInTheDocument();

    await user.click(deleteButton);
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: /Delete order permanently/i })).not.toBeInTheDocument();
  });

  it("hides the delete action when subscription write is disabled", () => {
    subscriptionState.canWrite = false;
    renderPanel();
    expect(screen.queryByRole("button", { name: /Delete order/i })).not.toBeInTheDocument();
  });
});
