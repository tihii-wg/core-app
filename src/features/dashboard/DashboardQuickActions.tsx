import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { cn } from "../../lib/utils";

export type DashboardQuickAction = {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
};

type DashboardQuickActionsProps = {
  actions: DashboardQuickAction[];
};

/**
 * Dashboard quick-action grid. Mobile (2-col) allows labels to wrap so long
 * locales (especially Russian) stay inside the button; sm+ keeps a single
 * truncated line like the previous desktop layout.
 */
export function DashboardQuickActions({ actions }: DashboardQuickActionsProps) {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="dashboard-quick-actions" className="rounded-lg border border-border bg-card p-4 shadow-xs">
      <h2 id="dashboard-quick-actions" className="mb-3 text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">
        {t("dashboard.quickActions.title")}
      </h2>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {actions.map(({ key, label, icon: Icon, onClick }) => (
          <Button
            key={key}
            onClick={onClick}
            variant="outline"
            className={cn(
              // Override Button's whitespace-nowrap + shrink-0 so grid cells can
              // shrink and Russian labels wrap instead of overflowing.
              "h-auto min-h-10 w-full min-w-0 shrink items-center justify-start gap-2 whitespace-normal px-2.5 py-2 text-left font-medium",
              "sm:h-10 sm:gap-2.5 sm:px-3 sm:py-0 sm:whitespace-nowrap",
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
              <Icon aria-hidden="true" className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1 text-left text-[13px] leading-snug [overflow-wrap:anywhere] sm:truncate sm:text-sm sm:leading-tight">
              {label}
            </span>
            <Plus aria-hidden="true" className="ml-auto hidden size-3.5 shrink-0 text-subtle-foreground xl:block" />
          </Button>
        ))}
      </div>
    </section>
  );
}
