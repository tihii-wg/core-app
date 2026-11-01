import i18n from "../i18n";
import supabase from "./supabase";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";

export type FinanceAccountType = "cash" | "cashless" | "card";

export type FinanceAccount = {
  id: string;
  workspaceId: string;
  locationId: string | null;
  name: string;
  scope: "company" | "location";
  accountType: FinanceAccountType;
  isVirtual: boolean;
  currencyCode: string;
  openingBalance: number;
  isActive: boolean;
  /** Opening balance plus ledger movements; null when `finance_transactions` is unavailable. */
  balance: number | null;
};

const accountColumns =
  "id, workspace_id, location_id, name, scope, account_type, is_virtual, currency_code, opening_balance, is_active, deleted_at";

const accountTypes: readonly FinanceAccountType[] = ["cash", "cashless", "card"];

function toNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function toFinanceAccount(row: Record<string, unknown>): FinanceAccount {
  const type = row.account_type as FinanceAccountType;
  const openingBalance = toNumber(row.opening_balance);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    locationId: typeof row.location_id === "string" ? row.location_id : null,
    name: typeof row.name === "string" ? row.name : "",
    scope: row.scope === "location" ? "location" : "company",
    accountType: accountTypes.includes(type) ? type : "cash",
    isVirtual: Boolean(row.is_virtual),
    currencyCode: typeof row.currency_code === "string" && row.currency_code ? row.currency_code : "MDL",
    openingBalance,
    isActive: row.is_active !== false,
    balance: openingBalance,
  };
}

type TransactionRow = {
  transaction_type: string;
  account_id: string | null;
  transfer_to_account_id: string | null;
  amount: number | string;
};

/** Pure running-balance math: income adds, expense subtracts, transfers move between accounts. */
export function applyTransactionsToBalances(accounts: FinanceAccount[], rows: TransactionRow[]): FinanceAccount[] {
  const balances = new Map(accounts.map((account) => [account.id, account.openingBalance]));
  const add = (id: string | null, delta: number) => {
    if (id && balances.has(id)) balances.set(id, (balances.get(id) ?? 0) + delta);
  };
  for (const row of rows) {
    const amount = toNumber(row.amount);
    if (row.transaction_type === "income") add(row.account_id, amount);
    else if (row.transaction_type === "expense") add(row.account_id, -amount);
    else if (row.transaction_type === "transfer") {
      add(row.account_id, -amount);
      add(row.transfer_to_account_id, amount);
    }
  }
  return accounts.map((account) => ({ ...account, balance: balances.get(account.id) ?? account.openingBalance }));
}

/** Finance accounts (кассы). Returns [] when `finance_accounts` is not applied yet. */
export async function getFinanceAccounts(workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("finance_accounts")
    .select(accountColumns)
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (error) {
    if (isMissingTableError(error, "finance_accounts")) return [] as FinanceAccount[];
    throw new Error(error.message);
  }

  const accounts = ((data ?? []) as Record<string, unknown>[]).map(toFinanceAccount);
  if (accounts.length === 0) return accounts;

  const { data: txns, error: txnError } = await supabase
    .from("finance_transactions")
    .select("transaction_type, account_id, transfer_to_account_id, amount")
    .eq("workspace_id", resolved)
    .is("deleted_at", null);

  if (txnError) {
    if (isMissingTableError(txnError, "finance_transactions")) return accounts.map((account) => ({ ...account, balance: null }));
    throw new Error(txnError.message);
  }
  return applyTransactionsToBalances(accounts, (txns ?? []) as TransactionRow[]);
}

export type CreateFinanceTransferInput = {
  workspaceId: string | undefined;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  comment?: string;
};

/**
 * Moves money between two cash accounts by inserting a `transfer` row into `finance_transactions`
 * (columns per crm_ro_v1: transaction_type, account_id = source, transfer_to_account_id = target,
 * amount > 0, currency_code, comment; created_by defaults to auth.uid()).
 * Insert RLS requires `finance.transactions.transfer`. Both accounts must share a currency.
 */
export async function createFinanceTransfer(input: CreateFinanceTransferInput) {
  const workspaceId = requireWorkspaceId(input.workspaceId);
  if (!input.fromAccountId || !input.toAccountId || input.fromAccountId === input.toAccountId) {
    throw new Error(i18n.t("finance.accounts.transfer.errors.sameAccount"));
  }
  const amount = Math.round((Number(input.amount) + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(i18n.t("finance.accounts.transfer.errors.amountPositive"));

  const { data: accounts, error: accountsError } = await supabase
    .from("finance_accounts")
    .select("id, currency_code")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .in("id", [input.fromAccountId, input.toAccountId]);
  if (accountsError) throw new Error(accountsError.message);
  const from = accounts?.find((row) => row.id === input.fromAccountId);
  const to = accounts?.find((row) => row.id === input.toAccountId);
  if (!from || !to) throw new Error(i18n.t("finance.accounts.transfer.errors.accountNotFound"));
  if (from.currency_code !== to.currency_code) throw new Error(i18n.t("finance.accounts.transfer.errors.currencyMismatch"));

  const comment = input.comment?.trim() ?? "";
  const { data, error } = await supabase
    .from("finance_transactions")
    .insert({
      workspace_id: workspaceId,
      transaction_type: "transfer",
      account_id: input.fromAccountId,
      transfer_to_account_id: input.toAccountId,
      amount,
      currency_code: from.currency_code,
      comment: comment || null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "42501") throw new Error(i18n.t("finance.accounts.transfer.errors.noPermission"));
    if (isMissingTableError(error, "finance_transactions")) throw new Error(i18n.t("finance.accounts.transfer.errors.unavailable"));
    throw new Error(error.message);
  }
  return data as { id: string };
}
