import { useEffect, useLayoutEffect } from "react";
import { Outlet, useLocation, useNavigate, useParams, Navigate } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { AppTopbar } from "./AppTopbar";
import { useGetWorkspaces } from "../features/workspaces/useGetWorkspaces";
import { useGetProfile } from "../features/profiles/useGetProfile";
import { useGetWorkspace } from "../features/workspaces/useGetWorkspace";
import { applyProfileTheme, cacheProfileTheme, normalizeProfileTheme, readCachedProfileTheme } from "../services/apiProfiles";
import { replaceLocale } from "../features/settings/settingsTab";
import { normalizeWorkspaceLanguage } from "../services/apiWorkspaces";

export function AppLayout() {
  const { workspaceId, locale = "en" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { workspaces, isLoading } = useGetWorkspaces();
  const { data: profile, isLoading: profileLoading } = useGetProfile();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const memberWorkspaceIds = (workspaces ?? []).flatMap((item) => {
    const workspace = item.workspaces as { id?: string } | { id?: string }[] | null | undefined;
    if (!workspace) return [];
    const entries = Array.isArray(workspace) ? workspace : [workspace];
    return entries.flatMap((entry) => (entry.id ? [entry.id] : []));
  });
  const canUseWorkspace = !workspaceId || memberWorkspaceIds.length === 0 || memberWorkspaceIds.includes(workspaceId);

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

  if (!isLoading && !profileLoading && workspaceId && memberWorkspaceIds.length > 0 && !memberWorkspaceIds.includes(workspaceId)) {
    const fallback = profile?.active_workspace_id;
    if (fallback && memberWorkspaceIds.includes(fallback)) {
      return <Navigate to={`/${locale}/${fallback}/dashboard`} replace />;
    }
    return <Navigate to={`/${locale}/dashboard`} replace />;
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <AppTopbar />
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
