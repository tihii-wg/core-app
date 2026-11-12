import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatWorkspaceMoney, workspacePreferenceDefaults } from "../../lib/workspaceFormat";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "./useGetWorkspace";

export function useWorkspaceMoney() {
  // Subscribes to language changes: amounts use the UI language's number format.
  const { i18n } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const currency = workspace?.currency ?? workspacePreferenceDefaults.currency;

  const language = i18n.language;
  // Stable identity per currency + language, so memoized children (order card rows, tables) can skip re-renders.
  return useMemo(
    () => ({
      currency,
      language,
      formatMoney(value: number | null | undefined) {
        return formatWorkspaceMoney(value ?? null, currency);
      },
    }),
    [currency, language],
  );
}
