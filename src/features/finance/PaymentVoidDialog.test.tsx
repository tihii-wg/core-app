import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { PaymentVoidDialog } from "./PaymentVoidDialog";
import type { LedgerPayment } from "./paymentTypes";

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (value: number) => `MDL ${value.toFixed(2)}`, currency: "MDL" }),
}));

function payment(overrides: Partial<LedgerPayment> = {}): LedgerPayment {
  return {
    id: "pay-1",
    workspaceId: "ws-1",
    orderId: "ord-1",
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

describe("PaymentVoidDialog", () => {
  it("distinguishes void from refund and refuses to record without schema support", async () => {
    const user = userEvent.setup();
    const row = payment();
    renderWithQuery(
      <PaymentVoidDialog open onOpenChange={vi.fn()} payment={row} allPayments={[row]} canRecord />,
    );

    expect(screen.getByRole("heading", { name: /Void erroneous payment/i })).toBeInTheDocument();
    expect(screen.getByText(/Refund = money was received/i)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/not available yet/i);

    await user.type(screen.getByLabelText(/Reason for void/i), "mistyped amount");
    await user.click(screen.getByRole("button", { name: /Confirm void/i }));
    expect(screen.getAllByText(/not available yet/i).length).toBeGreaterThanOrEqual(1);
  });

  it("validates required reason before the schema gate", async () => {
    const user = userEvent.setup();
    const row = payment();
    renderWithQuery(
      <PaymentVoidDialog open onOpenChange={vi.fn()} payment={row} allPayments={[row]} canRecord />,
    );
    await user.click(screen.getByRole("button", { name: /Confirm void/i }));
    expect(screen.getByText(/A reason is required/i)).toBeInTheDocument();
  });

  it("explains already-offset payments must use refund instead", () => {
    const original = payment({ id: "pay-1", amount: 50 });
    const refund = payment({
      id: "ref-1",
      kind: "refund",
      amount: 10,
      relatedPaymentId: "pay-1",
    });
    renderWithQuery(
      <PaymentVoidDialog
        open
        onOpenChange={vi.fn()}
        payment={original}
        allPayments={[original, refund]}
        canRecord
      />,
    );
    expect(screen.getByText(/already has refunds/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm void/i })).toBeDisabled();
  });
});
