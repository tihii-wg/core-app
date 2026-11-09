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

  it("shows step 2 after recording a payment for an open order", async () => {
    const user = userEvent.setup();
    renderDialog({ order });

    expect(screen.getByRole("button", { name: /Record payment/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Record payment/i }));

    expect(await screen.findByText(/What status should this order have/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Payment recorded/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /In Progress/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Leave as is \(New\)/i })).toBeInTheDocument();
  });

  it("does not show step 2 without an order prop", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.click(screen.getByRole("button", { name: /Record payment/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByText(/What status should this order have/i)).not.toBeInTheDocument();
  });

  it("does not show step 2 for closed or cancelled orders", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({
      order: { ...order, status: "closed", closedAt: "2026-01-02T00:00:00.000Z" },
    });

    await user.click(screen.getByRole("button", { name: /Record payment/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByText(/What status should this order have/i)).not.toBeInTheDocument();
  });

  it("does not show step 2 when the user cannot change status", async () => {
    statusState.canChangeStatus = false;
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({ order });

    await user.click(screen.getByRole("button", { name: /Record payment/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByText(/What status should this order have/i)).not.toBeInTheDocument();
  });

  it("keep current and closing the dialog do not call changeTo", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({ order });

    await user.click(screen.getByRole("button", { name: /Record payment/i }));
    expect(await screen.findByText(/What status should this order have/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Leave as is \(New\)/i }));
    expect(changeTo).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("tapping a status calls changeTo once and closes on success", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({ order });

    await user.click(screen.getByRole("button", { name: /Record payment/i }));
    expect(await screen.findByText(/What status should this order have/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /In Progress/i }));
    await waitFor(() => expect(changeTo).toHaveBeenCalledTimes(1));
    expect(changeTo).toHaveBeenCalledWith("system:in-progress");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("shows the failure reason and keeps the dialog open", async () => {
    changeTo.mockResolvedValue({ ok: false, reason: "Need more payment" });
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({ order });

    await user.click(screen.getByRole("button", { name: /Record payment/i }));
    expect(await screen.findByText(/What status should this order have/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /In Progress/i }));
    expect(await screen.findByText("Need more payment")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: /Leave as is \(New\)/i })).toBeInTheDocument();
  });
});
