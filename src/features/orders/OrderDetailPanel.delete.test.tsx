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
  useUpdateOrderTaxInvoiceNumber: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

vi.mock("./OrderAttachmentsSection", () => ({
  default: () => <div data-testid="order-attachments-stub" />,
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
  status: "new",
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
  invoiceNumber?: string;
  onDeleted?: (orderId: string) => void;
  setDetailPanelOpen?: (open: boolean) => void;
} = {}) {
  return renderWithQuery(
    <OrderDetailPanel
      selectedOrder={order}
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
    mutateAsync.mockResolvedValue({ id: "order-1", paymentsDeleted: 0 });
    deletePending.value = false;
    paymentsState.payments = [];
    subscriptionState.canWrite = true;
  });

  it("opens a confirmation dialog and cancels without deleting", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    renderPanel({ onDeleted });

    await user.click(screen.getByRole("button", { name: /Delete order/i }));
    expect(screen.getByRole("heading", { name: /Delete order\?/i })).toBeInTheDocument();
    expect(screen.getByText(/This cannot be undone/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /Delete order\?/i })).not.toBeInTheDocument();
    });
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("deletes the order and notifies the parent on confirm", async () => {
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

  it("mentions linked payments in the confirmation", async () => {
    const user = userEvent.setup();
    paymentsState.payments = [
      { id: "p1", orderId: "order-1", amount: 10, kind: "payment" } as LedgerPayment,
      { id: "p2", orderId: "order-1", amount: 5, kind: "refund" } as LedgerPayment,
      { id: "p3", orderId: "other", amount: 1, kind: "payment" } as LedgerPayment,
    ];
    mutateAsync.mockResolvedValue({ id: "order-1", paymentsDeleted: 2 });
    renderPanel();

    await user.click(screen.getByRole("button", { name: /Delete order/i }));
    expect(screen.getByText(/Delete order ORD-2026-003 and 2 linked payment/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete order \+ 2 payment/i })).toBeInTheDocument();
  });

  it("keeps invoice-linked orders intact and does not call delete", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    renderPanel({ invoiceNumber: "INV-1", onDeleted });

    const deleteButton = screen.getByRole("button", { name: /Delete order/i });
    expect(deleteButton).toBeDisabled();
    expect(screen.getByText(/has an invoice and cannot be deleted/i)).toBeInTheDocument();

    await user.click(deleteButton);
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: /Delete order\?/i })).not.toBeInTheDocument();
  });

  it("hides the delete action when subscription write is disabled", () => {
    subscriptionState.canWrite = false;
    renderPanel();
    expect(screen.queryByRole("button", { name: /Delete order/i })).not.toBeInTheDocument();
  });
});
