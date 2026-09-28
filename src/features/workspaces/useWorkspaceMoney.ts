import { useParams } from "react-router-dom";
import { formatWorkspaceMoney, workspacePreferenceDefaults } from "../../lib/workspaceFormat";
import { useGetWorkspace } from "./useGetWorkspace";

export function useWorkspaceMoney() {
  const { workspaceId } = useParams();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const currency = workspace?.currency ?? workspacePreferenceDefaults.currency;

  return {
    currency,
    formatMoney(value: number | null | undefined) {
      return formatWorkspaceMoney(value ?? null, currency);
    },
  };
}
