import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useGetInventoryMarkup, useUpdateInventoryMarkup } from "../workspaces/useInventoryMarkup";
import { canManageWorkspace } from "../workspaces/workspaceRoles";

export function useInventoryMarkupEditor() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const { data: markupPercent = 0, isLoading: markupLoading } = useGetInventoryMarkup(workspaceId);
  const { mutate: saveMarkup } = useUpdateInventoryMarkup();
  // The markup is stored on the workspace, which only the owner can update.
  const canSaveMarkup = canManageWorkspace(workspace?.role);
  const commitMarkup = (nextMarkup: number) => {
    if (!workspaceId || !canSaveMarkup || nextMarkup === markupPercent) return;
    saveMarkup({ workspaceId, markupPercent: nextMarkup });
  };
  return { markupPercent, markupLoading, commitMarkup };
}
