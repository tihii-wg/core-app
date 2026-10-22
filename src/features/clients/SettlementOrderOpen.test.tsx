import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Client, Order } from "../../lib/types";
import { renderWithQuery } from "../../tests/renderQuery";
import ClientDetailPanel from "./ClientDetailPanel";
import { clientOrderSummaries } from "./clientOrders";
import OrderDetailPanel from "../orders/OrderDetailPanel";
import { useOrderDetails } from "../orders/useOrderDetails";

vi.mock("../industries/useIndustryWorkflow", async () => {
  const { industryWorkflow, industryOrderCopy } = await import("../industries/industryWorkflow");
  return {
    useIndustryWorkflow: () => {
      const workflow = industryWorkflow("auto_repair");
      return {
        workflow,
        copy: industryOrderCopy(workflow),
        industrySlug: "auto_repair",
        industryId: null,
        isLoading: false,
        error: null,
      };
    },
  };
});

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (value: number) => `MDL ${value.toFixed(2)}` }),
}));

vi.mock("./useUpdateClient", () => ({
  useUpdateClient: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const order: Order = {
  id: "order-b",
  clientId: "client-1",
  clientName: "Ada Lovelace",
  orderNumber: "ORD-2026-002",
  device: "BMW",
  vin: "",
  carNumber: "",
  service: "Tires",
  services: [],
  description: "",
  status: "in-progress",
  assignedEmployeeId: "",
  assignedEmployeeName: "",
  deadline: "",
  totalPrice: 300,
  isPaid: false,
  paymentStatus: "unpaid",
  createdAt: "2026-10-02",
  updatedAt: "2026-10-02",
};

const client: Client = {
  id: "client-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "",
  address: "",
  balance: 0,
  created_at: "2024-07-01T10:00:00.000Z",
  notes: "",
  client_type: "individual",
  tax_id: null,
  contact_person: null,
};

function Harness() {
  const orderDetails = useOrderDetails();
  const orders = [order];
  const handleOpenHistoricalOrder = (orderId: string) => {
    const found = orders.find((item) => item.id === orderId);
    if (found) orderDetails.openOrder(found);
  };
  return (
    <>
      <ClientDetailPanel
        selectedClient={client}
        detailPanelOpen
        setDetailPanelOpen={() => {}}
        onClientUpdated={() => {}}
        getClientOrders={(clientId) => clientOrderSummaries(orders, clientId)}
        onOpenOrder={handleOpenHistoricalOrder}
      />
      <OrderDetailPanel {...orderDetails.panelProps} />
    </>
  );
}

describe("settlement -> order details (Clients wiring reproduction)", () => {
  it("opens the exact order in the order details sheet and closes the settlement dialog", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness />);

    await user.click(screen.getByRole("button", { name: "Mutual Settlement" }));
    const dialog = await screen.findByRole("dialog", { name: /Client Account Settlement/i });
    await user.click(within(dialog).getByRole("button", { name: "ORD-2026-002" }));

    // Settlement dialog closed
    expect(screen.queryByRole("dialog", { name: /Client Account Settlement/i })).not.toBeInTheDocument();
    // Order details sheet opened for the exact order (its sheet shows the order number heading)
    const headings = await screen.findAllByText("ORD-2026-002");
    expect(headings.length).toBeGreaterThan(0);
    expect(document.body.innerHTML).toContain("ORD-2026-002");
  });

  it("regression: the normal order history still opens the order directly", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness />);

    const sheetsBefore = document.querySelectorAll('[data-slot="sheet-content"]').length;
    const historyButtons = screen.getAllByRole("button", { name: /ORD-2026-002/ });
    await user.click(historyButtons[0]);

    // A second sheet (the order details) opened on top of the client panel.
    expect(document.querySelectorAll('[data-slot="sheet-content"]').length).toBeGreaterThan(sheetsBefore);
    // Settlement dialog was never opened in this flow.
    expect(screen.queryByRole("dialog", { name: /Client Account Settlement/i })).not.toBeInTheDocument();
  });
});
