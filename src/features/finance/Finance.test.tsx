import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "../../tests/renderQuery";
import { Finance } from "./Finance";

const financeState = vi.hoisted(() => ({
  isLoading: false,
  inPeriod: [] as { id: string; type: string; category: string; description: string; amount: number; date: string }[],
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
});
