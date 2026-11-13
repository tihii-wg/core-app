import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import type { GcalViewId } from "./calendarViewStorage";

type ViewLabelKey =
  | "calendar.views.day"
  | "calendar.views.threeDays"
  | "calendar.views.week"
  | "calendar.views.month"
  | "calendar.views.list";

type Option = { id: GcalViewId; labelKey: ViewLabelKey };

const ALL_OPTIONS: Option[] = [
  { id: "timeGridDay", labelKey: "calendar.views.day" },
  { id: "timeGrid3Day", labelKey: "calendar.views.threeDays" },
  { id: "timeGridWeek", labelKey: "calendar.views.week" },
  { id: "dayGridMonth", labelKey: "calendar.views.month" },
  { id: "listWeek", labelKey: "calendar.views.list" },
];

type Props = {
  activeView: string;
  isMobile: boolean;
  onChange: (view: GcalViewId) => void;
};

export function CalendarViewSwitcher({ activeView, isMobile, onChange }: Props) {
  const { t } = useTranslation();
  const options = isMobile ? ALL_OPTIONS : ALL_OPTIONS.filter((o) => o.id !== "timeGrid3Day");

  return (
    <div
      className={cn(
        "gcal-view-switcher flex gap-1",
        isMobile
          ? "max-w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] pb-0.5"
          : "flex-wrap",
      )}
      role="tablist"
      aria-label={t("calendar.views.switcher")}
    >
      {options.map((opt) => {
        const active = activeView === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={() => onChange(opt.id)}
          >
            {t(opt.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
