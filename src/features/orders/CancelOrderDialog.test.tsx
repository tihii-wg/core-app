import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import type { LedgerPayment } from "../finance/paymentTypes";
import { CancelOrderDialog } from "./CancelOrderDialog";

const cancelMutate = vi.hoisted(() => vi.fn());
const paymentsState = vi.hoisted(() => ({ payments: [] as LedgerPayment[] }));

vi.mock("./useCloseOrder", () => ({
  useCancelOrder: () => ({
    mutate: cancelMutate,
    isPending: false,
  }),
}));

vi.mock("../finance/usePayments", () => ({
  useGetPayments: () => ({ payments: paymentsState.payments, isLoading: false }),
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

vi.mock("../reports/reportFormatting", () => ({
  useReportFormatting: () => ({
    formatDate: (value: string) => value || "—",
  }),
}));

const order: Order = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Ada",
  orderNumber: "ORD-100",
  device: "",
  vin: "",
  carNumber: "",
  service: "",
  services: [],
  materials: [],
  description: "",
  status: "closed",
  closedAt: "2026-11-01T12:00:00.000Z",
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 100,
  isPaid: true,
  paymentStatus: "paid",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function payment(overrides: Partial<LedgerPayment> = {}): LedgerPayment {
  return {
    id: "pay-1",
    workspaceId: "ws-1",
    orderId: "order-1",
    invoiceId: null,
    relatedPaymentId: null,
    kind: "payment",
    amount: 100,
    currencyCode: "MDL",
    paymentMethod: "cash",
    paidAt: "2026-03-01T12:00:00.000Z",
    note: "",
    createdBy: null,
    createdAt: "2026-03-01T12:00:00.000Z",
    ...overrides,
  };
}

function renderDialog(onCancelled = vi.fn(), onOpenChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  const ui: ReactElement = (
    <CancelOrderDialog order={order} open onOpenChange={onOpenChange} onCancelled={onCancelled} />
  );
  render(ui, { wrapper: Wrapper });
  return { onCancelled, onOpenChange };
}

describe("CancelOrderDialog", () => {
  beforeEach(() => {
    paymentsState.payments = [];
    cancelMutate.mockReset();
  });

  it("shows a simple confirm and cancels without voiding when there are no payments", async () => {
    const user = userEvent.setup();
    const { onCancelled, onOpenChange } = renderDialog();
    cancelMutate.mockImplementation((_input: unknown, options?: { onSuccess?: (result: unknown) => void }) => {
      options?.onSuccess?.({
        status: "cancelled",
        customStatusId: null,
        customStatus: null,
        voidedCount: 0,
        voidedTotal: 0,
        skipped: [],
      });
    });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^cancel order$/i }));

    expect(cancelMutate).toHaveBeenCalledWith(
      { orderId: "order-1", voidPayments: false, reason: null },
      expect.any(Object),
    );
    await waitFor(() => {
      expect(onCancelled).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("lists payments with checkbox checked and voids with reason", async () => {
    const user = userEvent.setup();
    paymentsState.payments = [payment()];
    renderDialog();
    cancelMutate.mockImplementation((_input: unknown, options?: { onSuccess?: (result: unknown) => void }) => {
      options?.onSuccess?.({
        status: "cancelled",
        customStatusId: null,
        customStatus: null,
        voidedCount: 1,
        voidedTotal: 100,
        skipped: [],
      });
    });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/payments on this order/i)).toBeInTheDocument();
    expect(within(dialog).getAllByText("MDL 100.00").length).toBeGreaterThanOrEqual(1);
    const checkbox = within(dialog).getByRole("checkbox");
    expect(checkbox).toBeChecked();
    expect(within(dialog).getByRole("button", { name: /cancel order and void payments/i })).toBeEnabled();

    await user.click(within(dialog).getByRole("button", { name: /cancel order and void payments/i }));
    expect(cancelMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        voidPayments: true,
        reason: expect.stringMatching(/ORD-100/),
      }),
      expect.any(Object),
    );
  });

  it("sends voidPayments=false when the checkbox is unchecked", async () => {
    const user = userEvent.setup();
    paymentsState.payments = [payment()];
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox"));
    expect(within(dialog).getByRole("checkbox")).not.toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: /^cancel order$/i }));

    expect(cancelMutate).toHaveBeenCalledWith(
      { orderId: "order-1", voidPayments: false, reason: null },
      expect.any(Object),
    );
  });

  it("blocks confirm when the void reason is shorter than 8 characters", async () => {
    const user = userEvent.setup();
    paymentsState.payments = [payment()];
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    const reason = within(dialog).getByLabelText(/void reason|причин/i);
    await user.clear(reason);
    await user.type(reason, "short");
    expect(within(dialog).getByRole("button", { name: /cancel order and void payments/i })).toBeDisabled();
    expect(within(dialog).getByText(/at least 8|минимум 8|minimum 8/i)).toBeInTheDocument();
    expect(cancelMutate).not.toHaveBeenCalled();
  });

  it("shows a refunded-payments warning", async () => {
    paymentsState.payments = [
      payment({ id: "pay-1", amount: 80 }),
      payment({
        id: "refund-1",
        kind: "refund",
        amount: 20,
        relatedPaymentId: "pay-1",
      }),
    ];
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/cannot be voided automatically|нельзя аннулировать|nu pot fi anulate/i)).toBeInTheDocument();
  });
});
