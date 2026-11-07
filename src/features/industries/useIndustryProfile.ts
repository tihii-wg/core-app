import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { industryCapabilitiesFromProfile } from "./industryCapabilities";
import {
  industryProfile,
  industryTermKeyPath,
  type IndustryProfile,
  type IndustryTermKey,
} from "./industryProfile";
import { industryOrderCopy, industryShellCopy, industryWorkflow } from "./industryWorkflow";

/** Active workspace industry profile; updates when workspace industry or UI language changes. */
export function useIndustryProfile() {
  const { i18n } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace, isLoading, error } = useGetWorkspace(workspaceId);
  const profile = useMemo(() => industryProfile(workspace?.industrySlug), [workspace?.industrySlug]);
  const workflow = useMemo(() => industryWorkflow(profile.slug), [profile.slug]);
  const capabilities = useMemo(() => industryCapabilitiesFromProfile(profile), [profile]);
  // Recompute copy when language changes (helpers read i18n.t).
  void i18n.language;
  const copy = industryOrderCopy(workflow);
  const shell = industryShellCopy(workflow);

  return {
    profile,
    workflow,
    capabilities,
    copy,
    shell,
    industrySlug: workspace?.industrySlug ?? null,
    industryId: workspace?.industryId ?? null,
    isLoading,
    error,
  };
}

/** Translate an industry terminology key for the active workspace profile. */
export function useIndustryTerm() {
  const { t, i18n } = useTranslation();
  const { profile } = useIndustryProfile();
  void i18n.language;

  return useMemo(
    () =>
      function industryTerm(key: IndustryTermKey, options?: Record<string, unknown>) {
        return String(t(industryTermKeyPath(profile, key) as never, options as never));
      },
    [profile, t],
  );
}

export function industryTerm(profile: IndustryProfile, key: IndustryTermKey, t: (key: string) => string) {
  return t(industryTermKeyPath(profile, key));
}
