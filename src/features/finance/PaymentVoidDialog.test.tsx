import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { PaymentVoidDialog } from "./PaymentVoidDialog";
import type { LedgerPayment } from "./paymentTypes";

const mutate = vi.fn();

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (value: number) => `MDL ${value.toFixed(2)}`, currency: "MDL" }),
}));

vi.mock("./usePayments", () => ({
  useRecordPaymentVoid: () => ({ mutate, isPending: false }),
  useDeleteFullyVoidedPayment: () => ({ mutate: vi.fn(), isPending: false }),
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
  beforeEach(() => {
    mutate.mockReset();
  });

  it("distinguishes void from refund and records a void with a reason", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const row = payment();
    renderWithQuery(
      <PaymentVoidDialog open onOpenChange={onOpenChange} payment={row} allPayments={[row]} canRecord />,
    );

    expect(screen.getByRole("heading", { name: /Mark payment as erroneous/i })).toBeInTheDocument();
    expect(screen.getByText(/Refund = money was received/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Reason for void/i), "mistyped amount");
    await user.click(screen.getByRole("button", { name: /Confirm void/i }));
    expect(mutate).toHaveBeenCalledWith(
      { originalPaymentId: "pay-1", reason: "mistyped amount" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it("validates required reason before submit", async () => {
    const user = userEvent.setup();
    const row = payment();
    renderWithQuery(
      <PaymentVoidDialog open onOpenChange={vi.fn()} payment={row} allPayments={[row]} canRecord />,
    );
    await user.click(screen.getByRole("button", { name: /Confirm void/i }));
    expect(screen.getByText(/A reason is required/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
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
