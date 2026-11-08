import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice, Order } from "../../lib/types";
import { OrderCancelChainDialog } from "./OrderCancelChainDialog";

const cancelMutate = vi.hoisted(() => vi.fn());
const deleteMutateAsync = vi.hoisted(() => vi.fn());
const annulInvoice = vi.hoisted(() => vi.fn());
const deleteInvoice = vi.hoisted(() => vi.fn());
const refetchContext = vi.hoisted(() => vi.fn());
const toastFn = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));

vi.mock("react-hot-toast", () => ({
  default: toastFn,
}));

vi.mock("./useCloseOrder", () => ({
  useCancelOrder: () => ({
    mutate: cancelMutate,
    isPending: false,
  }),
}));

vi.mock("./useDeleteOrder", () => ({
  useDeleteOrder: () => ({
    mutateAsync: deleteMutateAsync,
    isPending: false,
  }),
}));

vi.mock("./useOrderCancelChain", () => ({
  useOrderCancelChainActions: () => ({
    refetchContext,
    annulInvoice,
    deleteInvoice,
    workspaceId: "ws-1",
    queryClient: {},
  }),
  invalidateAfterCancelChainStep: vi.fn(),
}));

vi.mock("../finance/usePayments", () => ({
  useGetPayments: () => ({ payments: [], isLoading: false }),
  invalidatePaymentViews: vi.fn(),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({
    formatMoney: (value: number) => `MDL ${value.toFixed(2)}`,
    currency: "MDL",
  }),
}));

vi.mock("../workspaces/useGetWorkspace", () => ({
  useGetWorkspace: () => ({ data: { currency: "MDL", dateFormat: "dd.MM.yyyy" } }),
}));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => "owner",
}));

vi.mock("../workspaces/useIsWorkspaceOwnerId", () => ({
  useIsWorkspaceOwnerId: () => true,
}));

const subscriptionState = vi.hoisted(() => ({ canWrite: true }));
vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({ canWrite: subscriptionState.canWrite }),
  useGuardSubscriptionWrite: () => () => undefined,
}));

vi.mock("../workspaces/workspaceSubscription", () => ({
  withSubscriptionWriteAccess: (_role: boolean, canWrite: boolean) => canWrite,
}));

vi.mock("../statuses/useGetStatusDefinitions", () => ({
  useGetStatusDefinitions: () => ({ data: [] }),
}));

vi.mock("../reports/reportFormatting", () => ({
  useReportFormatting: () => ({
    formatDate: (value: string) => value || "—",
  }),
}));

vi.mock("./useClosedOrderPermissions", () => ({
  useClosedOrderActionPermissions: () => ({
    canManageClosedContent: false,
    canCancelClosed: true,
    canDeleteClosed: true,
    role: "owner",
    grants: { cancelClosed: [], deleteClosed: [] },
    ownerCanManageClosedOrders: true,
    isOwnerByOwnerId: true,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("./closedOrderPermissions", async () => {
  const actual = await vi.importActual<typeof import("./closedOrderPermissions")>("./closedOrderPermissions");
  return {
    ...actual,
    canOfferDeleteClosedOrderAction: () => true,
  };
});

const order: Order = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Ada",
  orderNumber: "ORD-1",
  device: "",
  vin: "",
  carNumber: "",
  service: "",
  services: [],
  description: "",
  status: "in-progress",
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 100,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "",
  updatedAt: "",
};

function invoice(partial: Partial<Invoice> & Pick<Invoice, "id" | "invoiceNumber" | "status">): Invoice {
  return {
    workspaceId: "ws-1",
    clientId: "client-1",
    clientName: "Ada",
    device: "",
    carNumber: "",
    vin: "",
    description: "",
    subtotal: 50,
    amount: 50,
    total: 50,
    dueDate: "",
    createdAt: "2026-01-01",
    updatedAt: "",
    orderId: "order-1",
    ...partial,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderDialog(props?: Partial<React.ComponentProps<typeof OrderCancelChainDialog>>) {
  const onOpenChange = vi.fn();
  const onDeleted = vi.fn();
  const onOrderUpdated = vi.fn();
  render(
    <OrderCancelChainDialog
      order={order}
      open
      onOpenChange={onOpenChange}
      onDeleted={onDeleted}
      onOrderUpdated={onOrderUpdated}
      {...props}
    /> as ReactElement,
    { wrapper },
  );
  return { onOpenChange, onDeleted, onOrderUpdated };
}

function cancelResult() {
  return {
    customStatusId: null,
    customStatus: null,
    closed_at: null,
    voidedCount: 0,
    voidedTotal: 0,
    skipped: [],
    idempotent: false,
  };
}

beforeEach(() => {
  cancelMutate.mockReset();
  deleteMutateAsync.mockReset();
  annulInvoice.mockReset();
  deleteInvoice.mockReset();
  refetchContext.mockReset();
  toastFn.mockClear();
  subscriptionState.canWrite = true;
  cancelMutate.mockImplementation((_payload, opts) => {
    opts?.onSuccess?.(cancelResult());
  });
  deleteMutateAsync.mockResolvedValue({
    paymentsDeleted: 0,
    materialsReturned: [],
    storageCleanupComplete: true,
    attachmentStoragePaths: [],
  });
});

describe("OrderCancelChainDialog", () => {
  it("order without invoice: cancel → delete order", async () => {
    const user = userEvent.setup();
    refetchContext.mockResolvedValue({
      order: { ...order, status: "cancelled" },
      invoices: [],
      queue: [],
    });
    const { onDeleted } = renderDialog();

    await user.click(screen.getByRole("button", { name: /Отменить заказ|Cancel order/i }));
    await waitFor(() => expect(cancelMutate).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/Удалить заказ навсегда|Delete order permanently/i)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Удалить заказ|Delete order/i }));
    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledWith("order-1"));
    expect(onDeleted).toHaveBeenCalledWith("order-1");
  });

  it("order with one invoice: cancel → annul → delete invoice → delete order", async () => {
    const user = userEvent.setup();
    const inv = invoice({ id: "inv-1", invoiceNumber: "INV-1", status: "sent" });
    refetchContext
      .mockResolvedValueOnce({
        order: { ...order, status: "cancelled" },
        invoices: [inv],
        queue: [{ invoice: inv, alreadyErroneous: false }],
      })
      .mockResolvedValueOnce({
        order: { ...order, status: "cancelled" },
        invoices: [{ ...inv, status: "erroneous" }],
        queue: [{ invoice: { ...inv, status: "erroneous" }, alreadyErroneous: true }],
      })
      .mockResolvedValueOnce({
        order: { ...order, status: "cancelled" },
        invoices: [],
        queue: [],
      })
      .mockResolvedValueOnce({
        order: { ...order, status: "cancelled" },
        invoices: [],
        queue: [],
      });
    annulInvoice.mockResolvedValue({ ...inv, status: "erroneous" });
    deleteInvoice.mockResolvedValue({ invoiceId: "inv-1", invoiceNumber: "INV-1", orderId: "order-1" });

    renderDialog();
    await user.click(screen.getByRole("button", { name: /Отменить заказ|Cancel order/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Аннулировать счёт$|^Annul invoice$/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /^Аннулировать счёт$|^Annul invoice$/i }));
    await waitFor(() => expect(annulInvoice).toHaveBeenCalledWith("inv-1"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Удалить счёт$|^Delete invoice$/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /^Удалить счёт$|^Delete invoice$/i }));
    await waitFor(() => expect(deleteInvoice).toHaveBeenCalledWith("inv-1"));
    await waitFor(() => expect(screen.getByText(/Удалить заказ навсегда|Delete order permanently/i)).toBeInTheDocument());
  });

  it("two invoices: steps repeat per invoice", async () => {
    const user = userEvent.setup();
    const inv1 = invoice({ id: "inv-1", invoiceNumber: "INV-1", status: "sent", createdAt: "2026-01-01" });
    const inv2 = invoice({ id: "inv-2", invoiceNumber: "INV-2", status: "sent", createdAt: "2026-02-01" });
    refetchContext
      .mockResolvedValueOnce({
        order: { ...order, status: "cancelled" },
        invoices: [inv1, inv2],
        queue: [
          { invoice: inv1, alreadyErroneous: false },
          { invoice: inv2, alreadyErroneous: false },
        ],
      })
      .mockResolvedValueOnce({
        order: { ...order, status: "cancelled" },
        invoices: [{ ...inv1, status: "erroneous" }, inv2],
        queue: [
          { invoice: inv2, alreadyErroneous: false },
          { invoice: { ...inv1, status: "erroneous" }, alreadyErroneous: true },
        ],
      })
      .mockResolvedValueOnce({
        order: { ...order, status: "cancelled" },
        invoices: [inv2],
        queue: [{ invoice: inv2, alreadyErroneous: false }],
      });
    annulInvoice.mockResolvedValue({ ...inv1, status: "erroneous" });
    deleteInvoice.mockResolvedValue({ invoiceId: "inv-1", invoiceNumber: "INV-1", orderId: "order-1" });

    renderDialog();
    await user.click(screen.getByRole("button", { name: /Отменить заказ|Cancel order/i }));
    await waitFor(() => expect(screen.getByText(/1 из 2|1 of 2/i)).toBeInTheDocument());
    expect(screen.getByText(/INV-1/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Аннулировать счёт$|^Annul invoice$/i }));
    await waitFor(() => expect(annulInvoice).toHaveBeenCalledWith("inv-1"));
    await user.click(screen.getByRole("button", { name: /^Удалить счёт$|^Delete invoice$/i }));
    await waitFor(() => expect(deleteInvoice).toHaveBeenCalledWith("inv-1"));
    await waitFor(() => expect(screen.getByText(/INV-2/)).toBeInTheDocument());
  });

  it("«Не сейчас» after cancel stops the chain and keeps cancel result", async () => {
    const user = userEvent.setup();
    const inv = invoice({ id: "inv-1", invoiceNumber: "INV-9", status: "sent" });
    refetchContext.mockResolvedValue({
      order: { ...order, status: "cancelled" },
      invoices: [inv],
      queue: [{ invoice: inv, alreadyErroneous: false }],
    });
    const { onOpenChange } = renderDialog();

    await user.click(screen.getByRole("button", { name: /Отменить заказ|Cancel order/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Не сейчас|Not now/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Не сейчас|Not now/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(deleteMutateAsync).not.toHaveBeenCalled();
    expect(toastFn).toHaveBeenCalled();
  });

  it("skips invoice steps without permission and explains why", async () => {
    const user = userEvent.setup();
    subscriptionState.canWrite = false;
    const inv = invoice({ id: "inv-1", invoiceNumber: "INV-1", status: "sent" });
    refetchContext.mockResolvedValue({
      order: { ...order, status: "cancelled" },
      invoices: [inv],
      queue: [{ invoice: inv, alreadyErroneous: false }],
    });
    renderDialog();

    await user.click(screen.getByRole("button", { name: /Отменить заказ|Cancel order/i }));
    await waitFor(() =>
      expect(screen.getByText(/Недостаточно прав|don't have permission|Nu aveți dreptul/i)).toBeInTheDocument(),
    );
    expect(annulInvoice).not.toHaveBeenCalled();
  });

  it("shows cancel step with do-not-cancel secondary action", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /Не отменять|Don't cancel|Nu anula/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Отменить заказ|Cancel order/i })).toBeInTheDocument();
  });
});
