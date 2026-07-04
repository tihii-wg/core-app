import { useState } from "react";
import { Menu } from "lucide-react";
import { useApp } from "../lib/appContext";
import { useLocation } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./Dialog";
import AddNewWorkspaceForm from "../features/workspaces/AddNewWorkspaceForm";
import AppTopbarNotifications from "./AppTopbarNotifications";
import SearchComponent from "./SearchComponent";
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

  const [createModalOpen, setCreateModalOpen] = useState(false);

  return (
    <header className="h-14 bg-white border-b border-[#eeeeef] flex items-center justify-between px-4 sticky top-0 z-30">
      {/* Left section */}
      <div className="flex items-center gap-4">
        {/* Mobile menu button */}
        <button onClick={() => setMobileSidebarOpen(true)} className="lg:hidden p-2 -ml-2 text-[#939699] hover:text-[#282e33]">
          <Menu className="h-5 w-5" />
        </button>

        {/* Page title */}
        <h1 className="text-2xl font-semibold text-[#282e33]">{moduleLabels[currentTitle]}</h1>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <SearchComponent />

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
