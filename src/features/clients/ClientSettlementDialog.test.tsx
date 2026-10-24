import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "../../lib/types";
import ClientDetailPanel from "./ClientDetailPanel";
import ClientSettlementDialog from "./ClientSettlementDialog";
import type { ClientOrderSummary } from "./clientOrders";

function stubViewport(width: number) {
  const isMobile = width < 768;
  window.matchMedia = ((query: string) => ({
    matches: isMobile && String(query).includes("max-width"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
}

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
  summary({
    id: "b",
    orderNumber: "ORD-2026-002",
    totalPrice: 300,
    isPaid: false,
    device: "BMW 320d",
    carNumber: "ABC123",
    status: "completed",
  }),
  summary({ id: "c", orderNumber: "ORD-2026-003", totalPrice: 50, isPaid: true }),
];

beforeEach(() => {
  // Default suite assumes the desktop table layout.
  stubViewport(1280);
});

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

  it("constrains the dialog to the viewport with a fixed header/totals and independently scrolling regions", () => {
    render(
      <ClientSettlementDialog
        open
        onOpenChange={() => {}}
        clientName="Ada Lovelace"
        clientBalance={0}
        orders={mixedOrders}
        formatMoney={formatMoney}
        onOpenOrder={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");

    // The dialog itself never exceeds the visible viewport and never scrolls
    // as a whole, so the title and the Radix close button stay in place.
    expect(dialog.className).toContain("flex");
    expect(dialog.className).toContain("flex-col");
    expect(dialog.className).toContain("overflow-hidden");
    expect(dialog.className).toContain("max-h-[calc(100dvh-2rem)]");
    expect(dialog.className).toContain("max-w-[calc(100vw-2rem)]");

    // The summary cards live in a non-scrolling region above the scroll body.
    const finalBalanceLabel = within(dialog).getByText("Final settlement balance");
    const summaryRegion = finalBalanceLabel.closest("div.min-w-0.flex-none, div[class*='flex-none']");
    expect(summaryRegion).not.toBeNull();
    expect(summaryRegion?.className ?? "").not.toContain("overflow-y-auto");

    // The table sits inside a vertical scroll body and its own horizontal
    // scroll wrapper, so a wide table can never widen the dialog or page.
    const table = within(dialog).getByRole("table");
    const horizontalScroller = table.parentElement;
    expect(horizontalScroller?.className ?? "").toContain("overflow-x-auto");
    expect(horizontalScroller?.className ?? "").toContain("min-w-0");
    expect(horizontalScroller?.className ?? "").toContain("max-w-full");
    expect(table.className).toContain("min-w-[540px]");

    const verticalScroller = horizontalScroller?.parentElement;
    expect(verticalScroller?.className ?? "").toContain("overflow-y-auto");
    expect(verticalScroller?.className ?? "").toContain("min-w-0");
    expect(verticalScroller?.className ?? "").toContain("min-h-0");
    expect(verticalScroller?.className ?? "").toContain("flex-1");
  });

  it("renders unpaid orders as mobile cards with remaining amounts and opens details on tap", async () => {
    stubViewport(375);
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

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("table")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "ORD-2026-002" })).toBeInTheDocument();
    expect(within(dialog).getByText("BMW 320d")).toBeInTheDocument();
    expect(within(dialog).getByText("ABC123")).toBeInTheDocument();
    // Card + mobile totals footer both label the outstanding amount.
    expect(within(dialog).getAllByText("Remaining").length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).getAllByText("MDL 300.00").length).toBeGreaterThan(0);
    expect(within(dialog).queryByText("ORD-2026-001")).not.toBeInTheDocument();

    // Prefer truncation / break-all over a forced wide table min-width (portal lives on body).
    expect(dialog.querySelector(".truncate")).not.toBeNull();
    expect(dialog.querySelector(".break-all")).not.toBeNull();

    await user.click(within(dialog).getByText("BMW 320d"));
    expect(onOpenOrder).toHaveBeenCalledWith("b");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each([320, 360, 390, 414, 440])("keeps mobile settlement cards readable at %ipx width", (width) => {
    stubViewport(width);
    render(
      <ClientSettlementDialog
        open
        onOpenChange={() => {}}
        clientName="Ada Lovelace"
        clientBalance={0}
        orders={mixedOrders}
        formatMoney={formatMoney}
        onOpenOrder={() => {}}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("table")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "ORD-2026-002" })).toBeInTheDocument();
    expect(within(dialog).getAllByText("Remaining").length).toBeGreaterThanOrEqual(1);
    expect(dialog.querySelector(".break-all")).not.toBeNull();
  });
});
