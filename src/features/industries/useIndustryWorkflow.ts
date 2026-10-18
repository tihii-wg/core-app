import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { industryOrderCopy, industryWorkflow } from "./industryWorkflow";

/** Active workspace industry workflow; updates when the workspace or its industry changes. */
export function useIndustryWorkflow() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace, isLoading, error } = useGetWorkspace(workspaceId);
  const workflow = industryWorkflow(workspace?.industrySlug);
  const copy = industryOrderCopy(workflow);

  return {
    workflow,
    copy,
    industrySlug: workspace?.industrySlug ?? null,
    industryId: workspace?.industryId ?? null,
    isLoading,
    error,
  };
}
