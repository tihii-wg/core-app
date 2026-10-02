import { useState } from "react";
import { Menu } from "lucide-react";
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
    <header className="h-14 bg-white border-b border-[#eeeeef] flex items-center justify-between px-4 sticky top-0 z-30 print:hidden">
      {/* Left section */}
      <div className="flex items-center gap-4">
        {/* Mobile menu button */}
        <button onClick={() => setMobileSidebarOpen(true)} className="lg:hidden p-2 -ml-2 text-[#939699] hover:text-[#282e33]">
          <Menu className="h-5 w-5" />
        </button>

        <WorkspacePageMark />

        {/* Page title */}
        <h1 className="text-2xl font-semibold text-[#282e33]">{moduleLabels[currentTitle]}</h1>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <GlobalSearch key={workspaceId ?? "none"} />

        {/* Notifications */}
        <AppTopbarNotifications />

        {/* Company selector */}
        <CompanySelector setCreateModalOpen={setCreateModalOpen} />

        {/*Add company form*/}
        <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add New Workspace</DialogTitle>
              <DialogDescription>Fill in workspace name below</DialogDescription>
            </DialogHeader>

            <AddNewWorkspaceForm setCreateModalOpen={setCreateModalOpen} />
          </DialogContent>
        </Dialog>

        {/* User menu */}
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
  if (isLoading || (workspace?.avatarPath && logoLoading)) return <Skeleton className="size-8 rounded-full" />;
  if (!workspace) return null;

  return <WorkspaceAvatar name={workspace.name || "Company"} imageUrl={imageUrl} size="sm" />;
}
