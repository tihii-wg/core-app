import { describe, expect, it } from "vitest";
import type { Expense, Invoice } from "../../lib/types";
import {
  buildFinanceTransactions,
  expenseTransaction,
  financeAmount,
  financePeriodStats,
  outstandingInvoiceTotal,
  paidInvoiceIncome,
  transactionsInPeriod,
} from "./financeStats";

function invoice(partial: Partial<Invoice> & Pick<Invoice, "id" | "status">): Invoice {
  return {
    workspaceId: "ws-a",
    invoiceNumber: "INV-2026-001",
    clientId: "c1",
    clientName: "Ada",
    device: "",
    carNumber: "",
    vin: "",
    description: "",
    subtotal: partial.amount ?? partial.total ?? 100,
    amount: partial.amount ?? partial.total ?? 100,
    total: partial.total ?? partial.amount ?? 100,
    dueDate: "2026-06-01",
    createdAt: "2026-05-01",
    updatedAt: "2026-05-01",
    ...partial,
  };
}

function expense(partial: Partial<Expense> & Pick<Expense, "id">): Expense {
  return {
    date: "2026-06-10",
    category: "Rent",
    description: "Shop rent",
    amount: 50,
    paymentMethod: "cash",
    ...partial,
  };
}

describe("financeAmount", () => {
  it("rejects missing, zero, and non-finite amounts instead of treating them as zero money", () => {
    expect(financeAmount(null)).toBeNull();
    expect(financeAmount(undefined)).toBeNull();
    expect(financeAmount(0)).toBeNull();
    expect(financeAmount(-5)).toBeNull();
    expect(financeAmount(Number.NaN)).toBeNull();
    expect(financeAmount(12.5)).toBe(12.5);
  });
});

describe("paidInvoiceIncome", () => {
  it("counts only paid invoices that have paidAt and a positive total", () => {
    expect(
      paidInvoiceIncome(invoice({ id: "1", status: "paid", paidAt: "2026-06-15", amount: 80 }), {
        category: "Invoice payment",
        description: "INV · Ada",
      }),
    ).toMatchObject({ type: "income", amount: 80, date: "2026-06-15", relatedInvoiceId: "1" });

    expect(paidInvoiceIncome(invoice({ id: "2", status: "sent", paidAt: "2026-06-15", amount: 80 }), { category: "x", description: "y" })).toBeNull();
    expect(paidInvoiceIncome(invoice({ id: "3", status: "paid", amount: 80 }), { category: "x", description: "y" })).toBeNull();
    expect(paidInvoiceIncome(invoice({ id: "4", status: "paid", paidAt: "2026-06-15", amount: 0 }), { category: "x", description: "y" })).toBeNull();
  });
});

describe("expenseTransaction", () => {
  it("maps recorded expenses and skips invalid rows", () => {
    expect(expenseTransaction(expense({ id: "e1", amount: 40, date: "2026-06-02" }))).toMatchObject({
      type: "expense",
      amount: 40,
      date: "2026-06-02",
      paymentMethod: "cash",
    });
    expect(expenseTransaction(expense({ id: "e2", amount: Number.NaN }))).toBeNull();
  });
});

describe("buildFinanceTransactions and period stats", () => {
  const invoices = [
    invoice({ id: "paid-in", status: "paid", paidAt: "2026-06-10", amount: 100, workspaceId: "ws-a" }),
    invoice({ id: "paid-out", status: "paid", paidAt: "2026-05-01", amount: 200, workspaceId: "ws-a" }),
    invoice({ id: "open", status: "sent", amount: 75, workspaceId: "ws-a" }),
    invoice({ id: "overdue", status: "overdue", amount: 25, workspaceId: "ws-a" }),
    invoice({ id: "draft", status: "draft", amount: 999, workspaceId: "ws-a" }),
  ];
  const expenses = [
    expense({ id: "e-in", amount: 30, date: "2026-06-12", category: "Parts", paymentMethod: "card" }),
    expense({ id: "e-out", amount: 10, date: "2026-04-01", category: "Rent", paymentMethod: "cash" }),
  ];

  it("builds income and expense rows without double-counting drafts or unpaid invoices", () => {
    const rows = buildFinanceTransactions(invoices, expenses, (inv) => ({
      category: "Invoice payment",
      description: inv.invoiceNumber,
    }));
    expect(rows.map((row) => row.id)).toEqual(["expense-e-in", "invoice-paid-in", "invoice-paid-out", "expense-e-out"]);
    expect(rows.filter((row) => row.type === "income")).toHaveLength(2);
  });

  it("filters the selected date range for revenue and expenses", () => {
    const rows = buildFinanceTransactions(invoices, expenses, (inv) => ({
      category: "Invoice payment",
      description: inv.invoiceNumber,
    }));
    const inPeriod = transactionsInPeriod(rows, { start: "2026-06-01", end: "2026-06-30" });
    const stats = financePeriodStats(inPeriod, outstandingInvoiceTotal(invoices));

    expect(stats.income).toBe(100);
    expect(stats.expenses).toBe(30);
    expect(stats.profit).toBe(70);
    expect(stats.byCategory).toEqual([["Parts", 30]]);
    expect(stats.byMethod).toEqual([["card", 30]]);
  });

  it("keeps outstanding as a current snapshot of sent and overdue invoices", () => {
    expect(outstandingInvoiceTotal(invoices)).toBe(100);
    expect(outstandingInvoiceTotal(invoices.filter((row) => row.workspaceId === "ws-b"))).toBe(0);
  });

  it("does not mix another workspace's invoices when callers pass only the active workspace rows", () => {
    const foreign = invoice({ id: "other", status: "paid", paidAt: "2026-06-10", amount: 500, workspaceId: "ws-b" });
    const rows = buildFinanceTransactions([foreign], [], () => ({ category: "Invoice payment", description: "x" }));
    // Isolation is enforced by getInvoices/getExpenses workspace_id filters; this asserts mapping stays 1:1.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(500);
  });
});
