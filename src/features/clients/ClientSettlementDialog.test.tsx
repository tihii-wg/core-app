import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Client } from "../../lib/types";
import ClientDetailPanel from "./ClientDetailPanel";
import ClientSettlementDialog from "./ClientSettlementDialog";
import type { ClientOrderSummary } from "./clientOrders";

vi.mock("./useUpdateClient", () => ({
  useUpdateClient: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

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

const formatMoney = (value: number) => `MDL ${value.toFixed(2)}`;

function summary(partial: Partial<ClientOrderSummary>): ClientOrderSummary {
  return {
    id: "order-1",
    orderNumber: "ORD-2026-001",
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    totalPrice: 100,
    status: "completed",
    isPaid: false,
    createdAt: "2026-10-01",
    ...partial,
  };
}

const mixedOrders = [
  summary({ id: "a", orderNumber: "ORD-2026-001", totalPrice: 100, isPaid: true }),
  summary({ id: "b", orderNumber: "ORD-2026-002", totalPrice: 300, isPaid: false }),
  summary({ id: "c", orderNumber: "ORD-2026-003", totalPrice: 50, isPaid: true }),
];

function balanceValue() {
  const card = screen.getByText("Final settlement balance").closest("div");
  return card?.querySelectorAll("p")[1];
}

describe("ClientSettlementDialog", () => {
  it("lists only outstanding orders and reconciles the subtotal", () => {
    render(
      <ClientSettlementDialog
        open
        onOpenChange={() => {}}
        clientName="Ada Lovelace"
        clientBalance={0}
        orders={mixedOrders}
        formatMoney={formatMoney}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("ORD-2026-002")).toBeInTheDocument();
    expect(within(dialog).queryByText("ORD-2026-001")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("ORD-2026-003")).not.toBeInTheDocument();
    // Outstanding card (and footer) show the displayed remainder sum.
    expect(within(dialog).getAllByText("MDL 300.00").length).toBeGreaterThan(0);
    expect(balanceValue()?.textContent).toBe("MDL -300.00");
    expect(balanceValue()?.className).toContain("text-destructive");
  });

  it("combines the existing stored balance into the final balance", () => {
    render(
      <ClientSettlementDialog
        open
        onOpenChange={() => {}}
        clientName="Ada Lovelace"
        clientBalance={100}
        orders={mixedOrders}
        formatMoney={formatMoney}
      />,
    );
    expect(screen.getByText("MDL 100.00")).toBeInTheDocument(); // existing advance card
    expect(balanceValue()?.textContent).toBe("MDL -200.00");
    expect(balanceValue()?.className).toContain("text-destructive");
  });

  it("shows a green positive final balance when the advance exceeds outstanding", () => {
    render(
      <ClientSettlementDialog
        open
        onOpenChange={() => {}}
        clientName="Ada Lovelace"
        clientBalance={500}
        orders={mixedOrders}
        formatMoney={formatMoney}
      />,
    );
    expect(balanceValue()?.textContent).toBe("+MDL 200.00");
    expect(balanceValue()?.className).toContain("text-emerald-600");
  });

  it("keeps balances visible with the empty state when no unpaid orders exist", () => {
    render(
      <ClientSettlementDialog
        open
        onOpenChange={() => {}}
        clientName="Ada Lovelace"
        clientBalance={200}
        orders={[summary({ totalPrice: 100, isPaid: true })]}
        formatMoney={formatMoney}
      />,
    );
    expect(screen.getByText("No orders to settle")).toBeInTheDocument();
    expect(screen.getByText("MDL 200.00")).toBeInTheDocument();
    expect(balanceValue()?.textContent).toBe("+MDL 200.00");
    expect(balanceValue()?.className).toContain("text-emerald-600");
  });

  it("shows the error state when orders failed to load", () => {
    render(
      <ClientSettlementDialog open onOpenChange={() => {}} clientName="Ada Lovelace" clientBalance={0} orders={[]} ordersError formatMoney={formatMoney} />,
    );
    expect(screen.getByText("Could not load orders")).toBeInTheDocument();
  });

  it("opens the order when its row (not only the number) is clicked", async () => {
    const user = userEvent.setup();
    const onOpenOrder = vi.fn();
    render(
      <ClientSettlementDialog
        open
        onOpenChange={() => {}}
        clientName="Ada Lovelace"
        clientBalance={0}
        orders={mixedOrders}
        formatMoney={formatMoney}
        onOpenOrder={onOpenOrder}
      />,
    );

    const row = within(screen.getByRole("dialog")).getByText("ORD-2026-002").closest("tr");
    await user.click(row!);
    expect(onOpenOrder).toHaveBeenCalledWith("b");
  });

  it("calls onOpenOrder with the clicked order id and closes", async () => {
    const user = userEvent.setup();
    const onOpenOrder = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ClientSettlementDialog
        open
        onOpenChange={onOpenChange}
        clientName="Ada Lovelace"
        clientBalance={0}
        orders={mixedOrders}
        formatMoney={formatMoney}
        onOpenOrder={onOpenOrder}
      />,
    );

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "ORD-2026-002" }));
    expect(onOpenOrder).toHaveBeenCalledWith("b");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("ClientDetailPanel settlement entry point", () => {
  it("opens the settlement and forwards order clicks to the panel's existing order navigation", async () => {
    const user = userEvent.setup();
    const onOpenOrder = vi.fn();
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

    render(
      <ClientDetailPanel
        selectedClient={client}
        detailPanelOpen
        setDetailPanelOpen={() => {}}
        onClientUpdated={() => {}}
        getClientOrders={() => mixedOrders}
        onOpenOrder={onOpenOrder}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Mutual Settlement" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Client Account Settlement")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "ORD-2026-002" }));
    expect(onOpenOrder).toHaveBeenCalledWith("b");
  });
});
