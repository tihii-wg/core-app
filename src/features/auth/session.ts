import type { QueryClient } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router-dom";
import { resetProfileTheme } from "../../services/apiProfiles";

const publicAuthPath = /\/(login|register|forgot-password)\/?$/;

export function isPublicAuthPath(pathname: string) {
  return publicAuthPath.test(pathname);
}

export function finishSignOut(queryClient: QueryClient, navigate: NavigateFunction) {
  queryClient.clear();
  resetProfileTheme();

  const pathname = window.location.pathname;
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
}
