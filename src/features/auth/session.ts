import type { QueryClient } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router-dom";
import { resetProfileTheme, type ProfileRecord } from "../../services/apiProfiles";
import { clearPasswordRecoveryFlag } from "./passwordRecovery";
import { clearSessionIdleActivity } from "./sessionIdleTimeout";

const publicAuthPath = /\/(login|register|forgot-password|reset-password)\/?$/;

export function isPublicAuthPath(pathname: string) {
  return publicAuthPath.test(pathname);
}

export function finishSignOut(queryClient: QueryClient, navigate: NavigateFunction) {
  clearPasswordRecoveryFlag();
  clearSessionIdleActivity();
  queryClient.clear();
  resetProfileTheme();

  const pathname = window.location.pathname;
  // Stay on reset-password (and other public auth pages) so recovery success can remain visible after global sign-out.
  if (isPublicAuthPath(pathname)) return;

  const locale = pathname.split("/").filter(Boolean)[0] || "en";
  navigate(`/${locale}/login`, { replace: true });
}

export function clearWorkspaceQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: ["orders"] });
  queryClient.removeQueries({ queryKey: ["clients"] });
  queryClient.removeQueries({ queryKey: ["services"] });
  queryClient.removeQueries({ queryKey: ["employees"] });
  queryClient.removeQueries({ queryKey: ["inventory"] });
  queryClient.removeQueries({ queryKey: ["workspace-markup"] });
  queryClient.removeQueries({ queryKey: ["workspace-members"] });
}

// Keeps the cached profile in step with the server so AppLayout does not route back to the old workspace.
export function setCachedActiveWorkspace(queryClient: QueryClient, workspaceId: string | null) {
  queryClient.setQueryData<ProfileRecord | null>(["profiles"], (profile) => (profile ? { ...profile, active_workspace_id: workspaceId } : profile));
}
