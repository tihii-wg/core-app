import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { Order } from "../../lib/types";
import type { LedgerPayment } from "../finance/paymentTypes";
import { CloseOrderDialog } from "./CloseOrderDialog";

const closeMutate = vi.hoisted(() => vi.fn());
const closeMutateAsync = vi.hoisted(() => vi.fn());
const recordMutate = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const queryClientRef = vi.hoisted(() => ({ current: null as QueryClient | null }));

vi.mock("./useCloseOrder", () => ({
  useCloseOrder: () => ({
    mutate: closeMutate,
    mutateAsync: closeMutateAsync,
    isPending: false,
  }),
}));

vi.mock("../finance/usePayments", () => ({
  useRecordPayment: () => ({
    mutate: recordMutate,
    isPending: false,
  }),
}));

vi.mock("../finance/useFinanceAccounts", () => ({
  useFinanceAccounts: () => ({ data: [], isLoading: false }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({
    formatMoney: (value: number) => `MDL ${value.toFixed(2)}`,
    currency: "MDL",
  }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("react-hot-toast", () => ({
  default: { success: toastSuccess, error: vi.fn() },
}));

const baseOrder: Order = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Ada",
  orderNumber: "ORD-100",
  device: "Phone",
  vin: "",
  carNumber: "",
  service: "",
  services: [],
  materials: [],
  description: "",
  status: "in-progress",
  closedAt: null,
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 100,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function makePayment(amount: number, overrides: Partial<LedgerPayment> = {}): LedgerPayment {
  return {
    id: `pay-${amount}`,
    workspaceId: "ws-1",
    orderId: "order-1",
    invoiceId: null,
    relatedPaymentId: null,
    kind: "payment",
    amount,
    currencyCode: "MDL",
    paymentMethod: "cash",
    paidAt: "2026-11-06T10:00:00.000Z",
    note: "",
    createdBy: null,
    createdAt: "2026-11-06T10:00:00.000Z",
    ...overrides,
  };
}

function renderDialog(ui: ReactElement, seedPayments: LedgerPayment[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClientRef.current = client;
  client.setQueryData(["payments", "ws-1", {}], seedPayments);
  vi.spyOn(client, "refetchQueries").mockImplementation(async () => undefined);

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  return render(ui, { wrapper: Wrapper });
}

describe("CloseOrderDialog payment-to-close", () => {
  const formatMoney = (amount: number) => `MDL ${amount.toFixed(2)}`;
  const onOpenChange = vi.fn();
  const onClosed = vi.fn();

  beforeEach(() => {
    closeMutate.mockReset();
    closeMutateAsync.mockReset();
    recordMutate.mockReset();
    toastSuccess.mockReset();
    onOpenChange.mockReset();
    onClosed.mockReset();
    queryClientRef.current = null;

    closeMutateAsync.mockResolvedValue({
      status: "closed",
      closed_at: "2026-11-06T12:00:00.000Z",
      customStatusId: null,
      customStatus: null,
    });

    recordMutate.mockImplementation((input: { amount: number }, opts?: { onSuccess?: () => void }) => {
      const client = queryClientRef.current;
      const key = ["payments", "ws-1", {}] as const;
      const existing = (client?.getQueryData(key) as LedgerPayment[] | undefined) ?? [];
      client?.setQueryData(key, [...existing, makePayment(input.amount, { id: `pay-${existing.length + 1}` })]);
      opts?.onSuccess?.();
    });
  });

  it("shows the payment form with remaining prefilled when unpaid and canRecordPayment", async () => {
    renderDialog(
      <CloseOrderDialog
        order={baseOrder}
        open
        onOpenChange={onOpenChange}
        payments={[]}
        formatMoney={formatMoney}
        canRecordPayment
        onClosed={onClosed}
      />,
    );

    expect(await screen.findByText(/To close this order, record a payment/i)).toBeInTheDocument();
    const amount = screen.getByLabelText(/Amount/i) as HTMLInputElement;
    expect(amount.value).toBe("100");
    expect(screen.getByRole("checkbox", { name: /Close order after payment/i })).toBeChecked();
    expect(screen.getByRole("button", { name: /^Close order$/i })).toBeDisabled();
  });

  it("records full payment then closes when the checkbox is checked", async () => {
    const user = userEvent.setup();
    renderDialog(
      <CloseOrderDialog
        order={baseOrder}
        open
        onOpenChange={onOpenChange}
        payments={[]}
        formatMoney={formatMoney}
        canRecordPayment
        onClosed={onClosed}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Record payment/i }));

    await waitFor(() => {
      expect(recordMutate).toHaveBeenCalledTimes(1);
      expect(closeMutateAsync).toHaveBeenCalledTimes(1);
      expect(closeMutateAsync).toHaveBeenCalledWith("order-1");
    });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("records payment without closing when the checkbox is unchecked", async () => {
    const user = userEvent.setup();
    renderDialog(
      <CloseOrderDialog
        order={baseOrder}
        open
        onOpenChange={onOpenChange}
        payments={[]}
        formatMoney={formatMoney}
        canRecordPayment
        onClosed={onClosed}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /Close order after payment/i }));
    await user.click(screen.getByRole("button", { name: /Record payment/i }));

    await waitFor(() => {
      expect(recordMutate).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(closeMutateAsync).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("keeps the dialog open after a partial payment and shows the updated remaining", async () => {
    const user = userEvent.setup();
    renderDialog(
      <CloseOrderDialog
        order={baseOrder}
        open
        onOpenChange={onOpenChange}
        payments={[]}
        formatMoney={formatMoney}
        canRecordPayment
        onClosed={onClosed}
      />,
    );

    const amount = screen.getByLabelText(/Amount/i);
    await user.clear(amount);
    await user.type(amount, "40");
    await user.click(screen.getByRole("button", { name: /Record payment/i }));

    await waitFor(() => {
      expect(recordMutate).toHaveBeenCalledTimes(1);
      expect(closeMutateAsync).not.toHaveBeenCalled();
      expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/Remaining: MDL 60\.00/i));
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    const form = screen.getByRole("button", { name: /Record payment/i }).closest("form");
    expect(form).toBeTruthy();
    expect(within(form as HTMLElement).getByLabelText(/Amount/i)).toHaveValue(60);
    expect(within(form as HTMLElement).getByText("MDL 60.00")).toBeInTheDocument();
  });

  it("shows the blocked message and no form when canRecordPayment is false", async () => {
    renderDialog(
      <CloseOrderDialog
        order={baseOrder}
        open
        onOpenChange={onOpenChange}
        payments={[]}
        formatMoney={formatMoney}
        canRecordPayment={false}
        onClosed={onClosed}
      />,
    );

    expect(await screen.findByText(/Cannot close while MDL 100\.00 remains outstanding/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Amount/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Close order$/i })).toBeDisabled();
  });

  it("keeps the simple confirm flow for an already settled order", async () => {
    const user = userEvent.setup();
    const settled = makePayment(100);
    renderDialog(
      <CloseOrderDialog
        order={baseOrder}
        open
        onOpenChange={onOpenChange}
        payments={[settled]}
        formatMoney={formatMoney}
        canRecordPayment
        onClosed={onClosed}
      />,
      [settled],
    );

    expect(screen.queryByLabelText(/Amount/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/record a payment/i)).not.toBeInTheDocument();
    const closeBtn = screen.getByRole("button", { name: /^Close order$/i });
    expect(closeBtn).toBeEnabled();

    closeMutate.mockImplementation((_id: string, opts?: { onSuccess?: (r: unknown) => void }) => {
      opts?.onSuccess?.({
        status: "closed",
        closed_at: "2026-11-06T12:00:00.000Z",
        customStatusId: null,
        customStatus: null,
      });
    });

    await user.click(closeBtn);
    expect(closeMutate).toHaveBeenCalledWith("order-1", expect.any(Object));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
