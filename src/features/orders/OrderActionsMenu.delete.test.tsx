import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import type { Order } from "../../lib/types";
import { OrderActionsMenu } from "./OrderActionsMenu";

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock("./useDeleteOrder", () => ({
  useDeleteOrder: () => ({
    mutateAsync,
    isPending: false,
  }),
}));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => "owner",
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({ canWrite: true, isEntitlementPending: false }),
}));

vi.mock("../industries/useIndustryWorkflow", () => ({
  useIndustryWorkflow: () => ({
    workflow: { statuses: ["new", "in_progress", "completed", "cancelled", "paid"] },
  }),
}));

vi.mock("../statuses/useGetStatusDefinitions", () => ({
  useGetStatusDefinitions: () => ({ data: [], isLoading: false, error: null }),
}));

vi.mock("./useMoveOrderOnBoard", () => ({
  useMoveOrderOnBoard: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("./useCloseOrder", () => ({
  useCloseOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("../finance/usePayments", () => ({
  useGetPayments: () => ({ payments: [], isLoading: false, error: null }),
}));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (n: number) => String(n) }),
}));

vi.mock("../documents/useGetDocumentTemplates", () => ({
  useGetDocumentTemplates: () => ({ data: [], isLoading: false }),
}));

vi.mock("../documents/usePrintOrderDocument", () => ({
  usePrintOrderDocument: () => ({ mutate: vi.fn(), isPending: false }),
}));

const baseOrder = {
  id: "order-1",
  orderNumber: "ORD-1",
  clientId: "c1",
  clientName: "Ada",
  status: "cancelled",
  totalPrice: 100,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  workspaceId: "ws-1",
  device: "",
  carNumber: "",
  vin: "",
  description: "",
  deadline: null,
  assignedEmployeeId: "",
  services: [],
  materials: [],
} as unknown as Order;

const noop = vi.fn();

describe("OrderActionsMenu delete confirmation", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({ id: "order-1", paymentsDeleted: 2 });
  });

  it("states how many voided payments will be removed with a cancelled order", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <OrderActionsMenu
        order={baseOrder}
        linkedPaymentCount={2}
        onView={noop}
        onEdit={noop}
        onStatusChange={noop}
        onCreateInvoice={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Actions for order/i }));
    await user.click(screen.getByRole("menuitem", { name: /Delete order/i }));
    expect(screen.getByText(/Permanently delete cancelled order ORD-1/i)).toBeInTheDocument();
    expect(screen.getByText(/2 fully voided payment/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete order \+ 2 voided payment/i })).toBeInTheDocument();
  });

  it("refuses delete for a non-cancelled order", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <OrderActionsMenu
        order={{ ...baseOrder, status: "new" }}
        onView={noop}
        onEdit={noop}
        onStatusChange={noop}
        onCreateInvoice={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Actions for order/i }));
    const deleteItem = screen.getByRole("menuitem", { name: /Delete order/i });
    expect(deleteItem).toHaveAttribute("aria-disabled", "true");
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("keeps invoice restriction and does not call delete", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <OrderActionsMenu
        order={baseOrder}
        invoiceNumber="INV-1"
        linkedPaymentCount={1}
        onView={noop}
        onEdit={noop}
        onStatusChange={noop}
        onCreateInvoice={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Actions for order/i }));
    const deleteItem = screen.getByRole("menuitem", { name: /Delete order/i });
    expect(deleteItem).toHaveAttribute("aria-disabled", "true");
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
