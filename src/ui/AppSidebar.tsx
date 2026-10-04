import { useApp } from "../lib/appContext";
import type { AppModule } from "../lib/types";
import { LayoutDashboard, Users, ClipboardList, UserCog, Package, Wrench, FileText, Wallet, BarChart3, Settings, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { cn } from "../lib/utils";
import { useLocation, useNavigate } from "react-router-dom";
import { DEFAULT_LOCALE } from "../App";
import { LogoMark } from "./Logo";

interface NavItem {
  module: AppModule;
  label: string;
  icon: React.ElementType;
  /** Module still runs on sample data; shown as a visual hint next to the label. */
  demo?: boolean;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  { items: [{ module: "dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Operations",
    items: [
      { module: "orders", label: "Orders", icon: ClipboardList },
      { module: "clients", label: "Clients", icon: Users },
      { module: "services", label: "Services", icon: Wrench },
      { module: "inventory", label: "Inventory", icon: Package },
    ],
  },
  { label: "People", items: [{ module: "employees", label: "Employees", icon: UserCog }] },
  {
    label: "Finance",
    items: [
      { module: "invoices", label: "Invoices", icon: FileText },
      { module: "finance", label: "Finance", icon: Wallet, demo: true },
      { module: "reports", label: "Reports", icon: BarChart3 },
    ],
  },
];

const settingsItem: NavItem = { module: "settings", label: "Settings", icon: Settings };

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentWorkspaceId = location.pathname.split("/")[2];

  const currentNavItem = location.pathname.split("/")[3];

  const { setCurrentModule, sidebarCollapsed, setSidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen } = useApp();

  const handleNavClick = (module: AppModule) => {
    setCurrentModule(module);
    setMobileSidebarOpen(false);
    navigate(`/${DEFAULT_LOCALE}/${currentWorkspaceId}/${module}`);
  };

  // The collapsed rail only applies on desktop; the mobile drawer always shows labels.
  const collapsed = sidebarCollapsed && !mobileSidebarOpen;

  const renderItem = ({ module, label, icon: Icon, demo }: NavItem) => {
    const active = currentNavItem === module;
    return (
      <li key={module}>
        <button
          type="button"
          onClick={() => handleNavClick(module)}
          aria-current={active ? "page" : undefined}
          aria-label={collapsed ? label : undefined}
          title={collapsed ? label : undefined}
          className={cn(
            "group relative flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/35",
            active
              ? "bg-card text-foreground shadow-xs ring-1 ring-border dark:bg-sidebar-accent"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            collapsed && "justify-center px-0"
          )}
        >
          <Icon
            aria-hidden="true"
            className={cn("size-4 shrink-0 transition-colors", active ? "text-primary" : "text-subtle-foreground group-hover:text-foreground")}
          />
          {!collapsed && <span className="truncate">{label}</span>}
          {!collapsed && demo && (
            <span aria-hidden="true" className="ml-auto rounded px-1.5 py-px text-[10px] font-medium text-info ring-1 ring-info/25 ring-inset">
              Demo
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-[rgb(10_14_20/0.4)] backdrop-blur-[1px] animate-in fade-in-0 duration-150 lg:hidden print:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed top-0 left-0 z-50 flex h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width,transform] duration-200 ease-out print:hidden",
          "lg:sticky lg:z-auto",
          collapsed ? "w-16" : "w-60",
          mobileSidebarOpen ? "translate-x-0 shadow-lg lg:shadow-none" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Brand */}
        <div className={cn("flex h-14 shrink-0 items-center gap-2.5 px-4", collapsed && "justify-center px-0")}>
          <LogoMark className="size-7" />
          {!collapsed && <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">Core App</span>}

          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label="Close navigation"
            className="ml-auto inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-3">
          {navGroups.map((group, index) => (
            <div key={group.label ?? index} className={cn(index > 0 && "mt-5")}>
              {group.label &&
                (collapsed ? (
                  <div aria-hidden="true" className="mx-auto mb-2 h-px w-6 bg-sidebar-border" />
                ) : (
                  <p className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-subtle-foreground">{group.label}</p>
                ))}
              <ul className="space-y-0.5">{group.items.map(renderItem)}</ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 space-y-0.5 border-t border-sidebar-border px-3 py-3">
          <ul>{renderItem(settingsItem)}</ul>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "hidden h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-subtle-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground lg:flex",
              collapsed && "justify-center px-0"
            )}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="size-4 shrink-0" /> : <PanelLeftClose className="size-4 shrink-0" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
