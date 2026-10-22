import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Invoice } from "../../lib/types";
import { InvoiceCard } from "./InvoiceCard";

const invoice: Invoice = {
  id: "inv-1",
  workspaceId: "ws-1",
  invoiceNumber: "INV-2026-001",
  clientId: "client-1",
  clientName: "Alexandru Constantin Popescu-Mare",
  orderId: "order-1",
  orderNumber: "ORD-2026-003",
  device: "",
  carNumber: "",
  vin: "",
  description: "",
  subtotal: 100,
  amount: 100,
  total: 100,
  status: "sent",
  dueDate: "",
  createdAt: "2026-10-04",
  updatedAt: "2026-10-04",
};

function renderCard() {
  const onView = vi.fn();
  const onStatusChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InvoiceCard invoice={invoice} formatMoney={(v) => `MDL ${v.toFixed(2)}`} onView={onView} onStatusChange={onStatusChange} />
    </QueryClientProvider>,
  );
  return { onView, onStatusChange };
}

describe("InvoiceCard", () => {
  it("shows number, client, order, total and creation date", () => {
    renderCard();
    expect(screen.getByText("INV-2026-001")).toBeInTheDocument();
    expect(screen.getByText("Alexandru Constantin Popescu-Mare")).toBeInTheDocument();
    expect(screen.getByText("ORD-2026-003")).toBeInTheDocument();
    expect(screen.getByText("MDL 100.00")).toBeInTheDocument();
    expect(screen.getByText("2026-10-04")).toBeInTheDocument();
  });

  it("keeps print and menu actions independent from the card click", async () => {
    const user = userEvent.setup();
    const { onView, onStatusChange } = renderCard();

    const print = screen.getByRole("button", { name: "Print" });
    expect(print.className).toContain("size-10");
    const menuTrigger = screen.getByRole("button", { name: "Actions for invoice INV-2026-001" });
    expect(menuTrigger.className).toContain("size-10");

    await user.click(menuTrigger);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(onView).not.toHaveBeenCalled();

    await user.click(screen.getByRole("menuitem", { name: "Mark as paid" }));
    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ id: "inv-1" }), "paid");
    expect(onView).not.toHaveBeenCalled();
  });
});
