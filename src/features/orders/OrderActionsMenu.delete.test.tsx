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

const baseOrder = {
  id: "order-1",
  orderNumber: "ORD-1",
  clientId: "c1",
  clientName: "Ada",
  status: "new",
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

  it("states how many linked payments will be deleted", async () => {
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
    expect(screen.getByText(/Delete order ORD-1 and 2 linked payment/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete order \+ 2 payment/i })).toBeInTheDocument();
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
