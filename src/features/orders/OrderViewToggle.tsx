import { CalendarDays, Columns3, List } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import type { OrderViewMode } from "./orderBoard";

type OrderViewToggleProps = {
  value: OrderViewMode;
  onChange: (mode: OrderViewMode) => void;
  className?: string;
};

export function OrderViewToggle({ value, onChange, className }: OrderViewToggleProps) {
  const { t } = useTranslation();
  const options: { mode: OrderViewMode; label: string; icon: typeof List }[] = [
    { mode: "table", label: t("orders.views.table"), icon: List },
    { mode: "board", label: t("orders.views.board"), icon: Columns3 },
    { mode: "calendar", label: t("orders.views.calendar"), icon: CalendarDays },
  ];

  return (
    <div
      role="group"
      aria-label={t("orders.views.label")}
      className={cn("inline-flex h-9 shrink-0 items-center gap-0.5 rounded-lg bg-secondary p-[3px]", className)}
    >
      {options.map(({ mode, label, icon: Icon }) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(mode)}
            className={cn(
              "inline-flex h-full cursor-pointer items-center gap-1.5 rounded-md px-3 text-[13px] font-medium outline-none transition-[color,background-color,box-shadow] duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/35",
              active ? "bg-card text-foreground shadow-sm dark:bg-muted" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
