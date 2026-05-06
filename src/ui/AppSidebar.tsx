import { useApp } from "../lib/app-context";
import type { AppModule } from "../lib/types";
import { LayoutDashboard, Users, ClipboardList, UserCog, Package, Wrench, FileText, DollarSign, BarChart3, Settings, ChevronLeft, X } from "lucide-react";
import { cn } from "../lib/utils";
import { useNavigate } from "react-router-dom";

interface NavItem {
  module: AppModule;
  label: string;
  icon: React.ElementType;
}

const navItems: NavItem[] = [
  { module: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { module: "orders", label: "Orders", icon: ClipboardList },
  { module: "clients", label: "Clients", icon: Users },
  { module: "employees", label: "Employees", icon: UserCog },
  { module: "inventory", label: "Inventory", icon: Package },
  { module: "services", label: "Services", icon: Wrench },
  { module: "invoices", label: "Invoices", icon: FileText },
  { module: "finance", label: "Finance", icon: DollarSign },
  { module: "reports", label: "Reports", icon: BarChart3 },
  { module: "settings", label: "Settings", icon: Settings },
];

export function AppSidebar() {
  const  navigate  = useNavigate();
  const { currentModule, setCurrentModule, sidebarCollapsed, setSidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen } = useApp();

  const handleNavClick = (module: AppModule) => {
    setCurrentModule(module);
    setMobileSidebarOpen(false);
    navigate(`/${module}`)
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileSidebarOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMobileSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 h-full bg-white border-r border-[#eeeeef] z-50 transition-all duration-200",
          "lg:relative lg:z-auto",
          sidebarCollapsed ? "w-18" : "w-60",
          mobileSidebarOpen ? "translate-x-0 " : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Header */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-[#eeeeef]">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 bg-[#1973e1] rounded flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-sm">C</span>
            </div>
            {!sidebarCollapsed && <span className="font-semibold text-[#282e33]">Core App</span>}
          </div>

          {/* Mobile close button */}
          <button onClick={() => setMobileSidebarOpen(false)} className="lg:hidden p-1 text-[#939699] hover:text-[#282e33]">
            <X className={cn("h-5 w-5", mobileSidebarOpen && "hidde")} />
          </button>

          {/* Desktop collapse button */}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="hidden lg:block p-1 text-[#939699] hover:text-[#282e33]">
            <ChevronLeft className={cn("h-5 w-5 transition-transform", sidebarCollapsed && "rotate-180")} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-2 space-y-1">
          {navItems.map(({ module, label, icon: Icon }) => (
            <button
              key={module}
              onClick={() => handleNavClick(module)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition-colors",
                currentModule === module ? "bg-[#edf4fd] text-[#1973e1]" : "text-[#282e33] hover:bg-[#f1f3f5]",
                sidebarCollapsed && "justify-center"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!sidebarCollapsed && <span>{label}</span>}
            </button>
          ))}
        </nav>
      </aside>
    </>
  );
}
