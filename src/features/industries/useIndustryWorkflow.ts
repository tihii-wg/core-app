import { useIndustryProfile } from "./useIndustryProfile";

/** Active workspace industry workflow; updates when the workspace, industry, or UI language changes. */
export function useIndustryWorkflow() {
  const { workflow, copy, shell, industrySlug, industryId, isLoading, error, profile, capabilities } =
    useIndustryProfile();

  return {
    workflow,
    profile,
    capabilities,
    copy,
    shell,
    industrySlug,
    industryId,
    isLoading,
    error,
  };
}
