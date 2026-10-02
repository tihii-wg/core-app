import type { Transaction } from "../../lib/types";
import type { DataSourceResult } from "../demo/dataSource";
import { demoTransactions } from "./financeDemoData";

// The Finance UI reads transactions only through this hook. When the finance schema is final,
// replace the body with a workspace-scoped Supabase query and return `isDemo: false`.
export function useFinanceTransactions(): DataSourceResult<Transaction[]> {
  return { data: demoTransactions, isLoading: false, error: null, isDemo: true };
}
