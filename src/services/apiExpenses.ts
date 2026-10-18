import i18n from "../i18n";
import { paymentMethods, type Expense, type ExpenseFormData, type PaymentMethod } from "../lib/types";
import supabase from "./supabase";

const expenseColumns = "id, workspace_id, expense_date, category, description, amount, payment_method, created_at";

/** The expenses table is missing from the connected database (PostgREST PGRST205 / Postgres 42P01). */
export class ExpensesUnavailableError extends Error {
  constructor() {
    super(i18n.t("finance.expenses.errors.unavailable"));
    this.name = "ExpensesUnavailableError";
  }
}

type DbError = { code?: string; message: string };

function toExpenseError(error: DbError) {
  if (error.code === "PGRST205" || error.code === "42P01") return new ExpensesUnavailableError();
  return new Error(error.message);
}

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return workspaceId;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toExpense(row: Record<string, unknown>): Expense {
  const method = row.payment_method as PaymentMethod;
  return {
    id: String(row.id),
    date: text(row.expense_date).slice(0, 10),
    category: text(row.category),
    description: text(row.description),
    amount: Number(row.amount ?? 0),
    paymentMethod: paymentMethods.includes(method) ? method : "other",
  };
}

function toRow(input: ExpenseFormData) {
  return {
    expense_date: input.date,
    category: input.category.trim(),
    description: input.description.trim() || null,
    amount: Math.round(input.amount * 100) / 100,
    payment_method: input.paymentMethod,
  };
}

/** Expenses of the workspace, newest first. */
export async function getExpenses(workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("expenses")
    .select(expenseColumns)
    .eq("workspace_id", targetWorkspaceId)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw toExpenseError(error);
  return ((data ?? []) as Record<string, unknown>[]).map(toExpense);
}

export async function createExpense(input: ExpenseFormData, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("expenses")
    .insert({ workspace_id: targetWorkspaceId, ...toRow(input) })
    .select(expenseColumns)
    .single();

  if (error) throw error.code === "42501" ? new Error(i18n.t("finance.expenses.errors.noPermission")) : toExpenseError(error);
  return toExpense(data as Record<string, unknown>);
}

export async function updateExpense(expenseId: string, input: ExpenseFormData, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("expenses")
    .update(toRow(input))
    .eq("id", expenseId)
    .eq("workspace_id", targetWorkspaceId)
    .select(expenseColumns)
    .maybeSingle();

  if (error) throw toExpenseError(error);
  if (!data) throw new Error(i18n.t("finance.expenses.errors.noPermission"));
  return toExpense(data as Record<string, unknown>);
}

export async function deleteExpense(expenseId: string, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase.from("expenses").delete().eq("id", expenseId).eq("workspace_id", targetWorkspaceId).select("id");

  if (error) throw toExpenseError(error);
  if (!data || data.length === 0) throw new Error(i18n.t("finance.expenses.errors.noPermission"));
}
