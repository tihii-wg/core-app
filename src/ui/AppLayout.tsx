import { Outlet, useParams, Navigate } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { AppTopbar } from "./AppTopbar";
import { useGetWorkspaces } from "../features/workspaces/useGetWorkspaces";
import { useGetProfile } from "../features/profiles/useGetProfile";

export function AppLayout() {
  const { workspaceId, locale = "en" } = useParams();
  const { workspaces, isLoading } = useGetWorkspaces();
  const { data: profile, isLoading: profileLoading } = useGetProfile();
  const memberWorkspaceIds = (workspaces ?? []).flatMap((item) => {
    const workspace = item.workspaces as { id?: string } | { id?: string }[] | null | undefined;
    if (!workspace) return [];
    const entries = Array.isArray(workspace) ? workspace : [workspace];
    return entries.flatMap((entry) => (entry.id ? [entry.id] : []));
  });

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
