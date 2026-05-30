import { useState } from "react";
import { Menu, Search, Bell, ChevronDown, LogOut, User, Building2 } from "lucide-react";
import { Button } from "./Button";
import { Input } from "./Input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./DropdownMenu";
import { useApp } from "../lib/appContext";
import { useLogOut } from "../features/auth/useLogOut";
import { useGetWorkspaces } from "../features/workspaces/useGetWorkspaces";
import { useSetActiveWorkspace } from "../features/workspaces/useSetActiveWorkspace";
import { useUser } from "../features/auth/useUser";

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
  const { logOut } = useLogOut();
  const { workspaces: data } = useGetWorkspaces();
  const { updateWorkspace } = useSetActiveWorkspace();
  const { user } = useUser();

  
  const { currentModule, setMobileSidebarOpen } = useApp();
  const [searchQuery, setSearchQuery] = useState("");

  const userName = user.user_metadata.ownerName;

  const workspaces = (data ?? []).flatMap((item) => item.workspace ?? []);
  const currentWorkspace = workspaces?.find((item) => item.type === "current");

  const notifications = [
    { id: 1, title: "New order received", time: "5 min ago" },
    { id: 2, title: "Invoice #INV-2024-003 is overdue", time: "1 hour ago" },
    {
      id: 3,
      title: "Low stock alert: Samsung Galaxy S24 Screen",
      time: "2 hours ago",
    },
  ];

  function updateWorkspaceHandler(id: string) {
    updateWorkspace(id);
  }

  return (
    <header className="h-14 bg-white border-b border-[#eeeeef] flex items-center justify-between px-4 sticky top-0 z-30">
      {/* Left section */}
      <div className="flex items-center gap-4">
        {/* Mobile menu button */}
        <button onClick={() => setMobileSidebarOpen(true)} className="lg:hidden p-2 -ml-2 text-[#939699] hover:text-[#282e33]">
          <Menu className="h-5 w-5" />
        </button>

        {/* Page title */}
        <h1 className="text-2xl font-semibold text-[#282e33]">{moduleLabels[currentModule]}</h1>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="hidden  md:block relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#939699]" />
          <Input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64 h-9 pl-9 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-2  focus:ring-[#1973e1]/20 text-sm"
          />
        </div>

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-9 w-9 text-[#939699] hover:text-[#282e33]">
              <Bell className="h-5 w-5" />
              <span className="absolute top-1 right-1 h-2 w-2 bg-[#f41f20] rounded-full" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Notifications</span>
              <span className="text-xs font-normal text-[#1973e1] cursor-pointer hover:underline">Mark all read</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.map((notification) => (
              <DropdownMenuItem key={notification.id} className="flex flex-col items-start py-3 cursor-pointer">
                <span className="text-sm text-[#282e33]">{notification.title}</span>
                <span className="text-xs text-[#939699]">{notification.time}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-center text-[#1973e1] cursor-pointer justify-center">View all notifications</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Company selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="hidden sm:flex items-center gap-2 h-9 px-3 text-sm text-[#282e33]">
              <Building2 className="h-4 w-4 text-[#939699]" />
              <span className="max-w-30 truncate">{currentWorkspace?.name}</span>
              {/* {workspaces.map((w)=> )} */}

              <ChevronDown className="h-4 w-4 text-[#939699]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Switch Company</DropdownMenuLabel>
            <DropdownMenuSeparator />

            {workspaces?.map((w) => (
              <DropdownMenuItem onClick={() => updateWorkspaceHandler(w.id)} key={w?.id} className="cursor-pointer">
                <Building2 className="h-4 w-4 mr-2 text-[#939699]" />
                {w?.name}
              </DropdownMenuItem>
            ))}

            <DropdownMenuItem className="cursor-pointer text-[#1973e1]">+ Add company</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 h-9 px-2">
              <div className="h-8 w-8 bg-[#1973e1] rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-medium">{userName.charAt(0) || "U"}</span>
              </div>
              <ChevronDown className="h-4 w-4 text-[#939699] hidden sm:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="font-medium">{userName}</span>
                <span className="text-xs text-[#939699] font-normal">{user?.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer">
              <User className="h-4 w-4 mr-2 text-[#939699]" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer text-[#f41f20] focus:text-[#f41f20]" onClick={() => logOut()}>
              <LogOut className="h-4 w-4 mr-2" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
