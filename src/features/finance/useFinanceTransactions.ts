import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Transaction } from "../../lib/types";
import { useGetInvoices } from "../invoices/useGetInvoices";
import { useGetExpenses } from "./useExpenses";

/** Paid invoices (income, dated by when they were paid) and recorded expenses, newest first. */
export function useFinanceTransactions() {
  const { t } = useTranslation();
  const { invoices, isLoading: invoicesLoading, error: invoicesError, isUnavailable: invoicesUnavailable } = useGetInvoices();
  const { expenses, isLoading: expensesLoading, error: expensesError, isUnavailable: expensesUnavailable } = useGetExpenses();

  const transactions = useMemo(() => {
    const income: Transaction[] = invoices
      .filter((invoice) => invoice.status === "paid" && invoice.paidAt)
      .map((invoice) => ({
        id: `invoice-${invoice.id}`,
        type: "income",
        category: t("finance.categories.invoicePayment"),
        description: t("finance.invoiceDescription", { number: invoice.invoiceNumber, client: invoice.clientName || t("common.noValue") }),
        amount: invoice.amount,
        date: invoice.paidAt!,
        relatedOrderId: invoice.orderId,
        relatedInvoiceId: invoice.id,
      }));
    const spent: Transaction[] = expenses.map((expense) => ({
      id: `expense-${expense.id}`,
      type: "expense",
      category: expense.category,
      description: expense.description,
      amount: expense.amount,
      paymentMethod: expense.paymentMethod,
      date: expense.date,
      expense,
    }));
    return [...income, ...spent].sort((a, b) => b.date.localeCompare(a.date));
  }, [invoices, expenses, t]);

  const outstanding = useMemo(() => invoices.filter((invoice) => invoice.status === "sent" || invoice.status === "overdue"), [invoices]);

  return {
    transactions,
    outstanding,
    isLoading: invoicesLoading || expensesLoading,
    invoicesError: invoicesUnavailable ? null : invoicesError,
    expensesError: expensesUnavailable ? null : expensesError,
    invoicesUnavailable,
    expensesUnavailable,
  };
}
