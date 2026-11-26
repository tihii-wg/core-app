import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPrintCompany } from "../../services/printContext";
import { printHtmlDocument } from "../../services/apiDocumentTemplates";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useReportFormatting } from "../reports/reportFormatting";
import type { ClientSettlement } from "./clientSettlement";
import { settlementStatementHtml, settlementStatementText, type StatementCompany, type StatementInput } from "./clientSettlementDocument";

const COMPANY_STALE_MS = 5 * 60_000;

function companyQueryKey(workspaceId: string | undefined) {
  return ["workspace-print-company", workspaceId] as const;
}

/**
 * Print / e-mail of the client statement (взаиморасчёт). The company header (legal entity, address, logo) is read
 * once per workspace and cached; the money figures are the ones already on screen — no extra order / payment reads.
 */
export function useClientStatement({
  client,
  settlement,
  formatMoney,
  companyEnabled = false,
}: {
  client: { name: string; phone?: string; email?: string };
  settlement: ClientSettlement;
  formatMoney: (value: number) => string;
  /** Load the company header now (the e-mail dialog shows the text right away). */
  companyEnabled?: boolean;
}) {
  const { workspaceId } = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const { formatDate, formatDateTime } = useReportFormatting();
  const companyQuery = useQuery({
    queryKey: companyQueryKey(workspaceId),
    queryFn: () => getPrintCompany(workspaceId),
    enabled: Boolean(workspaceId) && companyEnabled,
    staleTime: COMPANY_STALE_MS,
  });

  const inputFor = useCallback(
    (company: StatementCompany): StatementInput => ({
      company,
      client,
      settlement,
      formatMoney,
      formatDate,
      generatedLabel: formatDateTime(new Date()),
    }),
    [client, settlement, formatMoney, formatDate, formatDateTime],
  );

  const print = useCallback(async () => {
    const company = await queryClient.fetchQuery({
      queryKey: companyQueryKey(workspaceId),
      queryFn: () => getPrintCompany(workspaceId),
      staleTime: COMPANY_STALE_MS,
    });
    printHtmlDocument(settlementStatementHtml(inputFor(company)));
  }, [queryClient, workspaceId, inputFor]);

  const text = companyQuery.data ? settlementStatementText(inputFor(companyQuery.data)) : "";

  return { print, text, company: companyQuery.data ?? null, companyLoading: companyQuery.isLoading, companyError: companyQuery.isError };
}
