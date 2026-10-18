import { useTranslation } from "react-i18next";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { industryOrderCopy, industryShellCopy, industryWorkflow } from "./industryWorkflow";

/** Active workspace industry workflow; updates when the workspace, industry, or UI language changes. */
export function useIndustryWorkflow() {
  const { i18n } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace, isLoading, error } = useGetWorkspace(workspaceId);
  const workflow = industryWorkflow(workspace?.industrySlug);
  // Recompute when language changes (copy helpers read i18n.t).
  const copy = industryOrderCopy(workflow);
  const shell = industryShellCopy(workflow);
  void i18n.language;

  return {
    workflow,
    copy,
    shell,
    industrySlug: workspace?.industrySlug ?? null,
    industryId: workspace?.industryId ?? null,
    isLoading,
    error,
  };
}
