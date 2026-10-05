import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Transaction } from "../../lib/types";
import type { DataSourceResult } from "../demo/dataSource";
import { demoTransactions } from "./financeDemoData";

// The Finance UI reads transactions only through this hook. When the finance schema is final,
// replace the body with a workspace-scoped Supabase query and return `isDemo: false`.
export function useFinanceTransactions(): DataSourceResult<Transaction[]> {
  const { i18n } = useTranslation();
  const language = i18n.language;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the demo labels are rebuilt when the language changes
  const data = useMemo(() => demoTransactions(), [language]);
  return { data, isLoading: false, error: null, isDemo: true };
}
