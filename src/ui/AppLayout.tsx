import { useEffect, useLayoutEffect } from "react";
import { Outlet, useLocation, useNavigate, useParams, Navigate } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { AppTopbar } from "./AppTopbar";
import { listedWorkspaceIds, useGetWorkspaces } from "../features/workspaces/useGetWorkspaces";
import { useGetProfile } from "../features/profiles/useGetProfile";
import { useGetWorkspace } from "../features/workspaces/useGetWorkspace";
import { applyProfileTheme, cacheProfileTheme, normalizeProfileTheme, readCachedProfileTheme } from "../services/apiProfiles";
import { replaceLocale } from "../features/settings/settingsTab";
import { normalizeWorkspaceLanguage } from "../services/apiWorkspaces";

export function AppLayout() {
  const { workspaceId, locale = "en" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { workspaces, isLoading, error: workspacesError } = useGetWorkspaces();
  const { data: profile, isLoading: profileLoading } = useGetProfile();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const memberWorkspaceIds = listedWorkspaceIds(workspaces);
  const activeWorkspaceId = profile?.active_workspace_id ?? null;
  const activeIsMember = Boolean(activeWorkspaceId && memberWorkspaceIds.includes(activeWorkspaceId));
  const workspaceContextReady = !isLoading && !workspacesError && !profileLoading && profile !== undefined;
  const canUseWorkspace = Boolean(workspaceId) && workspaceId === activeWorkspaceId && activeIsMember;

  const profileLoaded = profile !== undefined;
  const theme = profileLoaded ? normalizeProfileTheme(profile?.theme) : readCachedProfileTheme();

  useLayoutEffect(() => {
    if (!theme) return;
    if (profileLoaded) cacheProfileTheme(theme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyProfileTheme(theme, media.matches);
    apply();
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme, profileLoaded]);

  useEffect(() => {
    return () => {
      document.documentElement.classList.remove("dark");
    };
  }, []);

  useEffect(() => {
    const language = workspace?.language ? normalizeWorkspaceLanguage(workspace.language) : "";
    if (!canUseWorkspace || !language || !workspaceId || language === locale) return;
    const nextPath = replaceLocale(location.pathname, locale, language);
    if (nextPath === location.pathname) return;
    navigate(`${nextPath}${location.search}`, { replace: true });
  }, [canUseWorkspace, workspace?.language, workspaceId, locale, location.pathname, location.search, navigate]);

  // The route mirrors profiles.active_workspace_id; DashboardRedirect repairs a stale active workspace.
  if (workspaceContextReady && workspaceId && !canUseWorkspace) {
    if (activeWorkspaceId && activeIsMember) {
      const segments = location.pathname.split("/");
      segments[2] = activeWorkspaceId;
      return <Navigate to={`${segments.join("/")}${location.search}`} replace />;
    }
    return <Navigate to={`/${locale}/dashboard`} replace />;
  }

  return (
    <div className="flex min-h-screen bg-background print:block print:min-h-0 print:bg-white">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col print:block">
        <AppTopbar />
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7 print:overflow-visible print:p-0">
          <div className="mx-auto w-full max-w-[1440px] min-w-0 print:max-w-none">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
