import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Spinner } from "./Spinner";
import { useGetProfile } from "../features/profiles/useGetProfile";
import { listedWorkspaceIds, useGetWorkspaces } from "../features/workspaces/useGetWorkspaces";
import { useSetActiveWorkspace } from "../features/workspaces/useSetActiveWorkspace";
import { WaitingForInviteScreen } from "../features/auth/WaitingForInviteScreen";

const MEMBERSHIP_POLL_MS = 15_000;

export default function Dashboardredirect() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { locale = "en" } = useParams();
  const { data: profile, isLoading: profileLoading, error: profileError } = useGetProfile();
  const { workspaces, isLoading: workspacesLoading, error: workspacesError, refetch } = useGetWorkspaces();
  const { updateWorkspace } = useSetActiveWorkspace();
  const repairAttempted = useRef(false);

  const memberWorkspaceIds = useMemo(() => listedWorkspaceIds(workspaces), [workspaces]);
  const activeWorkspaceId = profile?.active_workspace_id ?? null;
  const ready = !profileLoading && !workspacesLoading && !profileError && !workspacesError && profile !== undefined;
  const noWorkspaces = ready && memberWorkspaceIds.length === 0;

  // Poll + refetch on focus while waiting for an invitation / membership.
  useEffect(() => {
    if (!noWorkspaces) return;

    const onFocus = () => {
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["profiles"] });
      void refetch();
    };

    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(onFocus, MEMBERSHIP_POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [noWorkspaces, queryClient, refetch]);

  useEffect(() => {
    if (!ready) return;
    if (memberWorkspaceIds.length === 0) return;

    if (activeWorkspaceId && memberWorkspaceIds.includes(activeWorkspaceId)) {
      navigate(`/${locale}/${activeWorkspaceId}/dashboard`, { replace: true });
      return;
    }

    // Saved workspace missing or membership removed: switch to one the user still belongs to.
    const fallback = memberWorkspaceIds[0];
    if (!fallback || repairAttempted.current) return;
    repairAttempted.current = true;
    void updateWorkspace(fallback)
      .then(() => {
        navigate(`/${locale}/${fallback}/dashboard`, { replace: true });
      })
      .catch(() => undefined);
  }, [ready, activeWorkspaceId, memberWorkspaceIds, locale, navigate, updateWorkspace]);

  const error = profileError ?? workspacesError;
  if (error) return <p className="p-6 text-sm text-destructive">{error.message}</p>;
  if (noWorkspaces) return <WaitingForInviteScreen email={profile?.email} />;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <Spinner />
    </div>
  );
}
