import { NavLink, Outlet } from "react-router-dom";
import { Building2, CreditCard, LayoutDashboard, LogOut, Menu, Shield, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { useT } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { BrandLockup } from "./BrandLogo";
import { PreferenceControls } from "./PreferenceControls";
import { Button } from "./ui";

export function AdminShell() {
  const t = useT();
  const { user, demoMode, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  const nav = [
    { to: "/", label: t("nav.overview"), icon: LayoutDashboard, end: true },
    { to: "/workspaces", label: t("nav.workspaces"), icon: Building2 },
    { to: "/subscriptions", label: t("nav.subscriptions"), icon: CreditCard },
    { to: "/security", label: t("nav.security"), icon: Shield },
  ] as const;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 border-r border-white/10 bg-[var(--sidebar)] text-[var(--sidebar-fg)] transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between gap-2 border-b border-white/10 px-4">
          <BrandLockup
            className="min-w-0"
            markClassName="size-7"
            nameClassName="text-[15px] font-semibold tracking-tight text-[var(--sidebar-fg)]"
            subtitleClassName="text-[var(--sidebar-muted)]"
            showSubtitle
          />
          <button
            type="button"
            className="shrink-0 rounded-md p-1 lg:hidden"
            aria-label={t("chrome.closeMenu")}
            onClick={() => setOpen(false)}
          >
            <X className="size-5" />
          </button>
        </div>
        <nav className="space-y-1 p-3" aria-label={t("app.navAria")}>
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={"end" in item ? item.end : false}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition",
                  isActive ? "bg-white/10 text-white" : "text-[var(--sidebar-muted)] hover:bg-white/5 hover:text-white",
                )
              }
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-[var(--overlay)] lg:hidden"
          aria-label={t("chrome.closeNavOverlay")}
          onClick={() => setOpen(false)}
        />
      ) : null}

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--bg-elevated)_92%,transparent)] px-3 backdrop-blur sm:gap-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="rounded-md p-1 lg:hidden"
              aria-label={t("chrome.openMenu")}
              onClick={() => setOpen(true)}
            >
              <Menu className="size-5" />
            </button>
            <p className="truncate text-sm text-[var(--muted)]">
              {demoMode ? t("chrome.demoMode") : (user?.email ?? t("chrome.signedIn"))}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PreferenceControls />
            <Button type="button" variant="secondary" onClick={() => void signOut()}>
              <LogOut className="size-4" />
              <span className="hidden sm:inline">{t("chrome.signOut")}</span>
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
