import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { PaymentActionsMenu } from "./PaymentActionsMenu";
import type { LedgerPayment } from "./paymentTypes";

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

const noopVoid = vi.fn();

describe("PaymentActionsMenu", () => {
  it("shows a three-dot trigger for every payment row", () => {
    renderWithQuery(
      <PaymentActionsMenu
        payment={payment()}
        allPayments={[payment()]}
        canRecord
        onRefund={vi.fn()}
        onVoidErroneous={noopVoid}
      />,
    );
    expect(screen.getByRole("button", { name: /Actions for Payment/i })).toBeInTheDocument();
  });

  it("exposes Record refund for real payments and Void for erroneous correction", async () => {
    const user = userEvent.setup();
    const onRefund = vi.fn();
    const onVoid = vi.fn();
    const original = payment();
    renderWithQuery(
      <PaymentActionsMenu
        payment={original}
        allPayments={[original]}
        canRecord
        onRefund={onRefund}
        onVoidErroneous={onVoid}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Actions for Payment/i }));
    expect(screen.getByRole("menuitem", { name: /Record refund/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Void erroneous payment/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^delete$/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: /Record refund/i }));
    expect(onRefund).toHaveBeenCalledWith(original);
  });

  it("does not offer refund or void for refund rows", async () => {
    const user = userEvent.setup();
    const original = payment({ id: "pay-1", amount: 50 });
    const refund = payment({
      id: "ref-1",
      kind: "refund",
      amount: 50,
      relatedPaymentId: "pay-1",
    });

    renderWithQuery(
      <PaymentActionsMenu
        payment={refund}
        allPayments={[original, refund]}
        canRecord
        onRefund={vi.fn()}
        onVoidErroneous={noopVoid}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Actions for Refund/i }));
    expect(screen.getByRole("menuitem", { name: /No available actions/i })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("menuitem", { name: /Record refund/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Void erroneous/i })).not.toBeInTheDocument();
  });

  it("hides refund for fully refunded payments but still offers void entry (explains already offset)", async () => {
    const user = userEvent.setup();
    const onVoid = vi.fn();
    const original = payment({ id: "pay-1", amount: 50 });
    const refund = payment({
      id: "ref-1",
      kind: "refund",
      amount: 50,
      relatedPaymentId: "pay-1",
    });

    renderWithQuery(
      <PaymentActionsMenu
        payment={original}
        allPayments={[original, refund]}
        canRecord
        onRefund={vi.fn()}
        onVoidErroneous={onVoid}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Actions for Payment/i }));
    expect(screen.queryByRole("menuitem", { name: /Record refund/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Void erroneous payment/i }));
    expect(onVoid).toHaveBeenCalledWith(original);
  });

  it("disables void when the user cannot record payments", async () => {
    const user = userEvent.setup();
    const original = payment();
    renderWithQuery(
      <PaymentActionsMenu
        payment={original}
        allPayments={[original]}
        canRecord={false}
        onRefund={vi.fn()}
        onVoidErroneous={noopVoid}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Actions for Payment/i }));
    expect(screen.queryByRole("menuitem", { name: /Record refund/i })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Void erroneous payment/i })).toHaveAttribute("aria-disabled", "true");
  });
});
