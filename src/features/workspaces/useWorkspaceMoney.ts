import { formatWorkspaceMoney, workspacePreferenceDefaults } from "../../lib/workspaceFormat";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "./useGetWorkspace";

export function useWorkspaceMoney() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const currency = workspace?.currency ?? workspacePreferenceDefaults.currency;

  return {
    currency,
    formatMoney(value: number | null | undefined) {
      return formatWorkspaceMoney(value ?? null, currency);
    },
  };
}
