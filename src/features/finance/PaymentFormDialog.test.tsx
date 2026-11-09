import type { ComponentProps } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
import { PaymentFormDialog } from "./PaymentFormDialog";

const recordPayment = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

const changeTo = vi.hoisted(() => vi.fn());
const statusState = vi.hoisted(() => ({
  canChangeStatus: true,
  options: [
    {
      kind: "system" as const,
      id: "system:new",
      name: "New",
      color: null,
      systemStatus: "new" as const,
      semanticAction: "normal" as const,
      definition: null,
      disabled: false,
      disabledReason: null,
    },
    {
      kind: "system" as const,
      id: "system:in-progress",
      name: "In Progress",
      color: "#3366ff",
      systemStatus: "in-progress" as const,
      semanticAction: "normal" as const,
      definition: null,
      disabled: false,
      disabledReason: null,
    },
  ],
  current: {
    kind: "system" as const,
    id: "system:new",
    name: "New",
    color: null,
    systemStatus: "new" as const,
    semanticAction: "normal" as const,
    definition: null,
  },
  isPending: false,
}));

vi.mock("./usePayments", () => ({
  useGetPayments: () => ({
    payments: [],
    isLoading: false,
    isFetching: false,
    refetch: vi.fn().mockResolvedValue({ data: [] }),
    error: null,
    isUnavailable: false,
  }),
  useRecordPayment: () => recordPayment,
  invalidatePaymentViews: vi.fn(),
}));

vi.mock("./useFinanceAccounts", () => ({
  useFinanceAccounts: () => ({ data: [], isLoading: false }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (n: number) => `${n.toFixed(2)}`, currency: "MDL" }),
}));

vi.mock("../profiles/useGetProfile", () => ({
  useActiveWorkspaceId: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("../orders/useOrderStatusChange", async () => {
  const actual = await vi.importActual<typeof import("../orders/useOrderStatusChange")>("../orders/useOrderStatusChange");
  return {
    ...actual,
    useOrderStatusChange: () => ({
      options: statusState.options,
      current: statusState.current,
      changeTo,
      isPending: statusState.isPending,
      canChangeStatus: statusState.canChangeStatus,
      paidStatusLocked: false,
      lifecycleStatusLocked: false,
      paidStatusBlocked: false,
      subscriptionAllowsWrite: true,
    }),
  };
});

const order = {
  id: "order-1",
  clientId: "client-1",
  clientName: "Ada",
  clientEmail: "",
  clientPhone: "",
  orderNumber: "ORD-1",
  vehicleId: "",
  device: "",
  vin: "",
  carNumber: "",
  service: "",
  services: [],
  materials: [],
  description: "",
  status: "new",
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 100,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  closedAt: null,
  customStatusId: null,
  customStatus: null,
} as Order;

const balance = {
  total: 100,
  netPaid: 0,
  remaining: 100,
  overpayment: 0,
  status: "unpaid" as const,
  hasLedger: false,
  isLegacyUnreconciled: false,
};

function renderDialog(props: Partial<ComponentProps<typeof PaymentFormDialog>> = {}) {
  const onOpenChange = vi.fn();
  renderWithQuery(
    <PaymentFormDialog
      open
      onOpenChange={onOpenChange}
      target="order"
      orderId="order-1"
      balance={balance}
      {...props}
    />,
  );
  return { onOpenChange };
}

describe("PaymentFormDialog post-payment status step", () => {
  beforeEach(() => {
    recordPayment.mutate.mockReset();
    changeTo.mockReset();
    statusState.canChangeStatus = true;
    statusState.isPending = false;
    recordPayment.mutate.mockImplementation((_input, opts) => {
      opts?.onSuccess?.();
    });
    changeTo.mockResolvedValue({ ok: true, order: { ...order, status: "in-progress" } });
  });

  it("shows the status field in the payment form for an open order", () => {
    renderDialog({ order });
    expect(screen.getByLabelText(/Order status after payment/i)).toBeInTheDocument();
  });

  it("does not show the status field without an order prop", () => {
    renderDialog();
    expect(screen.queryByLabelText(/Order status after payment/i)).not.toBeInTheDocument();
  });

  it("does not show the status field for closed or cancelled orders", () => {
    renderDialog({ order: { ...order, status: "cancelled" } });
    expect(screen.queryByLabelText(/Order status after payment/i)).not.toBeInTheDocument();
  });

  it("does not show the status field when the user cannot change status", () => {
    statusState.canChangeStatus = false;
    renderDialog({ order });
    expect(screen.queryByLabelText(/Order status after payment/i)).not.toBeInTheDocument();
  });

  it("keeping the current status records the payment, closes, and never calls changeTo", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({ order });
    await user.click(screen.getByRole("button", { name: /Record payment/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(changeTo).not.toHaveBeenCalled();
  });

  it("a chosen status is applied once right after the payment", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({ order });
    await user.click(screen.getByLabelText(/Order status after payment/i));
    await user.click(await screen.findByRole("option", { name: /In Progress/i }));
    await user.click(screen.getByRole("button", { name: /Record payment/i }));
    await waitFor(() => expect(changeTo).toHaveBeenCalledTimes(1));
    expect(changeTo).toHaveBeenCalledWith("system:in-progress");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("if the chosen status fails, the payment stays and step 2 shows the reason", async () => {
    changeTo.mockResolvedValueOnce({ ok: false, reason: "Need more payment" });
    const user = userEvent.setup();
    renderDialog({ order });
    await user.click(screen.getByLabelText(/Order status after payment/i));
    await user.click(await screen.findByRole("option", { name: /In Progress/i }));
    await user.click(screen.getByRole("button", { name: /Record payment/i }));
    expect(await screen.findByText("Need more payment")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Payment recorded/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Leave as is \(New\)/i })).toBeInTheDocument();
  });
});
