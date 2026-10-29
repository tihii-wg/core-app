import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { Finance } from "./Finance";

const financeState = vi.hoisted(() => ({
  isLoading: false,
  inPeriod: [] as Record<string, unknown>[],
  payments: [] as {
    id: string;
    workspaceId: string;
    orderId: string | null;
    invoiceId: string | null;
    relatedPaymentId: string | null;
    kind: "payment" | "refund";
    amount: number;
    currencyCode: string;
    paymentMethod: "cash" | "card" | "bank_transfer" | "other";
    paidAt: string;
    note: string;
    createdBy: string | null;
    createdAt: string;
  }[],
  stats: {
    grossReceipts: 0,
    invoiceLinkedReceipts: 0,
    noInvoiceReceipts: 0,
    refunds: 0,
    netReceipts: 0,
    expenses: 0,
    netOperating: 0,
    outstandingTotal: 0,
    legacyUnreconciledTotal: 0,
    byCategory: [] as [string, number][],
    byMethod: [] as [string, number][],
    byPaymentMethod: [] as [string, number][],
  },
  legacyItems: [] as { kind: string; id: string; label: string; amount: number; attributedDate: string | null; dateReliable: boolean }[],
  invoicesError: null as Error | null,
  expensesError: null as Error | null,
  paymentsError: null as Error | null,
  invoicesUnavailable: false,
  expensesUnavailable: false,
  paymentsUnavailable: false,
  refetch: vi.fn(),
}));

vi.mock("./useFinanceTransactions", () => ({
  useFinanceTransactions: () => ({
    transactions: financeState.inPeriod,
    inPeriod: financeState.inPeriod,
    payments: financeState.payments,
    stats: financeState.stats,
    legacyItems: financeState.legacyItems,
    isLoading: financeState.isLoading,
    hasError: Boolean(financeState.invoicesError || financeState.expensesError || financeState.paymentsError),
    invoicesError: financeState.invoicesError,
    expensesError: financeState.expensesError,
    paymentsError: financeState.paymentsError,
    invoicesUnavailable: financeState.invoicesUnavailable,
    expensesUnavailable: financeState.expensesUnavailable,
    paymentsUnavailable: financeState.paymentsUnavailable,
    refetch: financeState.refetch,
  }),
}));

vi.mock("./RefundFormDialog", () => ({ RefundFormDialog: () => null }));
vi.mock("./PaymentVoidDialog", () => ({ PaymentVoidDialog: () => null }));

vi.mock("../workspaces/useWorkspaceMoney", () => ({
  useWorkspaceMoney: () => ({ formatMoney: (value: number) => `MDL ${value.toFixed(2)}`, currency: "MDL" }),
}));

vi.mock("../workspaces/useActiveWorkspaceRole", () => ({
  useActiveWorkspaceRole: () => "owner",
}));

vi.mock("../workspaces/useWorkspaceSubscription", () => ({
  useWorkspaceSubscription: () => ({ canWrite: true, isEntitlementPending: false }),
}));

vi.mock("../workspaces/SubscriptionReadOnlyNotice", () => ({
  SubscriptionReadOnlyNotice: () => null,
}));

vi.mock("../reports/reportFormatting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../reports/reportFormatting")>();
  return {
    ...actual,
    useReportFormatting: () => ({ formatDate: (value: string) => value }),
  };
});

vi.mock("./ExpenseFormDialog", () => ({ ExpenseFormDialog: () => null }));
vi.mock("./DeleteExpenseDialog", () => ({ DeleteExpenseDialog: () => null }));

describe("Finance page", () => {
  beforeEach(() => {
    financeState.isLoading = false;
    financeState.inPeriod = [];
    financeState.payments = [];
    financeState.legacyItems = [];
    financeState.stats = {
      grossReceipts: 120,
      invoiceLinkedReceipts: 80,
      noInvoiceReceipts: 40,
      refunds: 0,
      netReceipts: 120,
      expenses: 40,
      netOperating: 80,
      outstandingTotal: 55,
      legacyUnreconciledTotal: 0,
      byCategory: [["Parts", 40]],
      byMethod: [["card", 40]],
      byPaymentMethod: [["cash", 120]],
    };
    financeState.invoicesError = null;
    financeState.expensesError = null;
    financeState.paymentsError = null;
    financeState.invoicesUnavailable = false;
    financeState.expensesUnavailable = false;
    financeState.paymentsUnavailable = false;
    financeState.refetch.mockReset();
  });

  it("shows real period totals from the finance snapshot", () => {
    renderWithQuery(<Finance />);
    expect(screen.getByRole("heading", { name: "Finance" }).closest(".space-y-6")).toHaveTextContent("MDL 120.00");
    expect(screen.getByRole("heading", { name: "Finance" }).closest(".space-y-6")).toHaveTextContent("MDL 55.00");
    expect(screen.getAllByText("MDL 40.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MDL 80.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/Invoice and order remaining/i)).toBeInTheDocument();
  });

  it("shows loading skeletons instead of zeroed money while data loads", () => {
    financeState.isLoading = true;
    financeState.stats = {
      grossReceipts: 0,
      invoiceLinkedReceipts: 0,
      noInvoiceReceipts: 0,
      refunds: 0,
      netReceipts: 0,
      expenses: 0,
      netOperating: 0,
      outstandingTotal: 0,
      legacyUnreconciledTotal: 0,
      byCategory: [],
      byMethod: [],
      byPaymentMethod: [],
    };
    const { container } = renderWithQuery(<Finance />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByText("MDL 0.00")).not.toBeInTheDocument();
  });

  it("shows an empty transactions state when the period has no rows", () => {
    renderWithQuery(<Finance />);
    expect(screen.getByText(/No transactions in this period/i)).toBeInTheDocument();
  });

  it("surfaces query errors with retry", async () => {
    const user = userEvent.setup();
    financeState.invoicesError = new Error("invoices offline");
    renderWithQuery(<Finance />);
    expect(screen.getByText("invoices offline")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(financeState.refetch).toHaveBeenCalled();
  });

  it("shows unreconciled legacy amounts separately from confirmed receipts", () => {
    financeState.stats.legacyUnreconciledTotal = 200;
    financeState.legacyItems = [
      { kind: "invoice", id: "inv-1", label: "INV-1", amount: 200, attributedDate: "2026-01-01", dateReliable: true },
    ];
    renderWithQuery(<Finance />);
    expect(screen.getByText(/Unreconciled legacy records/i)).toBeInTheDocument();
    expect(screen.getByText(/INV-1/)).toBeInTheDocument();
  });

  it("shows a three-dot actions menu on payment rows with refund when supported", async () => {
    const user = userEvent.setup();
    const ledgerPayment = {
      id: "pay-1",
      workspaceId: "ws-1",
      orderId: "ord-1",
      invoiceId: null as string | null,
      relatedPaymentId: null as string | null,
      kind: "payment" as const,
      amount: 80,
      currencyCode: "MDL",
      paymentMethod: "cash" as const,
      paidAt: "2026-03-10T10:00:00.000Z",
      note: "",
      createdBy: null as string | null,
      createdAt: "2026-03-10T10:00:00.000Z",
    };
    const refundRow = {
      ...ledgerPayment,
      id: "ref-1",
      kind: "refund" as const,
      amount: 20,
      relatedPaymentId: "pay-1",
    };
    financeState.payments = [ledgerPayment, refundRow];
    financeState.inPeriod = [
      {
        id: "payment-pay-1",
        type: "income",
        category: "Order payment",
        description: "Order #1",
        amount: 80,
        date: "2026-03-10",
        paymentMethod: "cash",
        kind: "payment",
        source: "ledger",
        payment: ledgerPayment,
      },
      {
        id: "payment-ref-1",
        type: "refund",
        category: "Refund",
        description: "Order #1",
        amount: 20,
        date: "2026-03-11",
        paymentMethod: "cash",
        kind: "refund",
        source: "ledger",
        payment: refundRow,
      },
    ];

    renderWithQuery(<Finance />);

    const paymentMenu = screen.getByRole("button", { name: /Actions for Payment/i });
    const refundMenu = screen.getByRole("button", { name: /Actions for Refund/i });
    expect(paymentMenu).toBeInTheDocument();
    expect(refundMenu).toBeInTheDocument();

    await user.click(paymentMenu);
    expect(screen.getByRole("menuitem", { name: /Record refund/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Void erroneous payment/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^delete$/i })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(refundMenu);
    expect(screen.queryByRole("menuitem", { name: /Record refund/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Void erroneous/i })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /No available actions/i })).toHaveAttribute("aria-disabled", "true");
  });
});

