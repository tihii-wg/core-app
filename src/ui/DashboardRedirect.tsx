import { useNavigate, useParams } from "react-router-dom";
import { Spinner } from "./Spinner";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useGetProfile } from "../features/profiles/useGetProfile";
import { listedWorkspaceIds, useGetWorkspaces } from "../features/workspaces/useGetWorkspaces";
import { useSetActiveWorkspace } from "../features/workspaces/useSetActiveWorkspace";

export default function Dashboardredirect() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale = "en" } = useParams();
  const { data: profile, isLoading: profileLoading, error: profileError } = useGetProfile();
  const { workspaces, isLoading: workspacesLoading, error: workspacesError } = useGetWorkspaces();
  const { updateWorkspace } = useSetActiveWorkspace();
  const repairAttempted = useRef(false);

  const memberWorkspaceIds = useMemo(() => listedWorkspaceIds(workspaces), [workspaces]);
  const activeWorkspaceId = profile?.active_workspace_id ?? null;
  const ready = !profileLoading && !workspacesLoading && !profileError && !workspacesError && Boolean(profile);
  const noWorkspaces = ready && memberWorkspaceIds.length === 0;

  useEffect(() => {
    if (!ready) return;

    if (activeWorkspaceId && memberWorkspaceIds.includes(activeWorkspaceId)) {
      navigate(`/${locale}/${activeWorkspaceId}/dashboard`, { replace: true });
      return;
    }

    // The saved workspace was deleted or the membership was removed: switch to one the user still belongs to.
    const fallback = memberWorkspaceIds[0];
    if (!fallback || repairAttempted.current) return;
    repairAttempted.current = true;
    void updateWorkspace(fallback).catch(() => undefined);
  }, [ready, activeWorkspaceId, memberWorkspaceIds, locale, navigate, updateWorkspace]);

  const error = profileError ?? workspacesError;
  if (error) return <p className="p-6 text-sm text-destructive">{error.message}</p>;
  if (noWorkspaces) return <p className="p-6 text-sm text-muted-foreground">{t("workspaces.redirect.noWorkspaces")}</p>;

  return <Spinner />;
}
