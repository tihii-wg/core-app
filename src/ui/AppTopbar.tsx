import { useState } from "react";
import { ChevronRight, Menu } from "lucide-react";
import { useApp } from "../lib/appContext";
import { useLocation, useParams } from "react-router-dom";
import { useGetWorkspace } from "../features/workspaces/useGetWorkspace";
import { useWorkspaceAvatar } from "../features/workspaces/useWorkspaceAvatar";
import { Skeleton } from "./Skeleton";
import { WorkspaceAvatar } from "./WorkspaceAvatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./Dialog";
import AddNewWorkspaceForm from "../features/workspaces/AddNewWorkspaceForm";
import AppTopbarNotifications from "./AppTopbarNotifications";
import GlobalSearch from "../features/search/GlobalSearch";
import CompanySelector from "./CompanySelector";
import UserMenu from "./UserMenu";

const moduleLabels: Record<string, string> = {
  dashboard: "Dashboard",
  orders: "Orders",
  clients: "Clients",
  employees: "Employees",
  inventory: "Inventory",
  services: "Services",
  invoices: "Invoices",
  finance: "Finance",
  reports: "Reports",
  settings: "Settings",
};

export function AppTopbar() {
  const location = useLocation();

  const currentTitle = location.pathname.split("/")[3];

  const { setMobileSidebarOpen } = useApp();
  const { workspaceId } = useParams();

  const [createModalOpen, setCreateModalOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 lg:px-6 print:hidden">
      {/* Page context */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          aria-label="Open navigation"
          className="-ml-1.5 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="size-5" />
        </button>

        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <WorkspacePageMark />
          {moduleLabels[currentTitle] && (
            <>
              <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-subtle-foreground" />
              <span aria-current="page" className="shrink-0 whitespace-nowrap font-medium text-foreground">
                {moduleLabels[currentTitle]}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <GlobalSearch key={workspaceId ?? "none"} />

        <AppTopbarNotifications />

        <div aria-hidden="true" className="mx-1 hidden h-5 w-px bg-border sm:block" />

        <CompanySelector setCreateModalOpen={setCreateModalOpen} />

        <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add New Workspace</DialogTitle>
              <DialogDescription>Fill in workspace name below</DialogDescription>
            </DialogHeader>

            <AddNewWorkspaceForm setCreateModalOpen={setCreateModalOpen} />
          </DialogContent>
        </Dialog>

        <UserMenu />
      </div>
    </header>
  );
}

function WorkspacePageMark() {
  const { workspaceId } = useParams();
  const { data: workspace, isLoading } = useGetWorkspace(workspaceId);
  const { data: imageUrl, isLoading: logoLoading } = useWorkspaceAvatar(workspace?.id, workspace?.avatarPath);

  if (!workspaceId) return null;
  if (isLoading || (workspace?.avatarPath && logoLoading)) return <Skeleton className="size-7 rounded-md" />;
  if (!workspace) return null;

  return (
    <span className="flex min-w-0 items-center gap-2">
      <WorkspaceAvatar name={workspace.name || "Company"} imageUrl={imageUrl} size="sm" className="size-7 rounded-md text-[11px] *:rounded-md" />
      <span className="hidden max-w-40 truncate text-muted-foreground xl:inline">{workspace.name}</span>
    </span>
  );
}
