import { describe, expect, it } from "vitest";
import { isMissingTableError } from "./missingTable";
import { applyTransactionsToBalances, toFinanceAccount } from "./apiFinanceAccounts";

const base = { workspace_id: "ws", currency_code: "MDL", account_type: "cash" };

describe("finance accounts", () => {
  it("keeps the total unchanged for transfers between accounts", () => {
    const accounts = [
      toFinanceAccount({ ...base, id: "a", name: "Cash", opening_balance: "100" }),
      toFinanceAccount({ ...base, id: "b", name: "Bank", opening_balance: 50, account_type: "cashless" }),
    ];
    const result = applyTransactionsToBalances(accounts, [
      { transaction_type: "income", account_id: "a", transfer_to_account_id: null, amount: "40" },
      { transaction_type: "expense", account_id: "a", transfer_to_account_id: null, amount: 10 },
      { transaction_type: "transfer", account_id: "a", transfer_to_account_id: "b", amount: 30 },
    ]);
    expect(result.map((a) => a.balance)).toEqual([100, 80]);
    expect(result.reduce((sum, a) => sum + (a.balance ?? 0), 0)).toBe(180);
  });

  it("detects missing tables", () => {
    expect(isMissingTableError({ code: "PGRST205" })).toBe(true);
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
    expect(isMissingTableError({ code: "42501", message: "permission denied" }, "finance_accounts")).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});
