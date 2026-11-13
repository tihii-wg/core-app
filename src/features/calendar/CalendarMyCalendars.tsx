import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, CalendarRange } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { isWritableAccessRole } from "./gcalColors";
import type {
  GoogleCalendarErrorEntry,
  GoogleCalendarListItem,
  GoogleMainCalendar,
  GoogleVisibleCalendar,
} from "../../services/apiGoogleCalendar";

export type CalendarLegendItem = {
  id: string;
  summary: string;
  backgroundColor: string | null;
  accessRole: string;
  isMain: boolean;
  selected: boolean;
};

type ListProps = {
  items: CalendarLegendItem[];
  editable: boolean;
  calendarErrors?: GoogleCalendarErrorEntry[];
  onToggle?: (calendarId: string, nextSelected: boolean) => void;
  disabled?: boolean;
};

export function buildOwnerCalendarItems(
  calendars: GoogleCalendarListItem[],
  mainId: string | null | undefined,
): CalendarLegendItem[] {
  const main = (mainId ?? "").trim();
  const sorted = [...calendars].sort((a, b) => {
    if (a.id === main) return -1;
    if (b.id === main) return 1;
    return a.summary.localeCompare(b.summary);
  });
  return sorted.map((c) => ({
    id: c.id,
    summary: c.summary,
    backgroundColor: c.backgroundColor,
    accessRole: c.accessRole,
    isMain: c.id === main,
    selected: Boolean(c.selected) || c.id === main,
  }));
}

export function buildMemberLegendItems(
  main: GoogleMainCalendar | null | undefined,
  visible: GoogleVisibleCalendar[],
): CalendarLegendItem[] {
  const items: CalendarLegendItem[] = [];
  if (main?.id) {
    items.push({
      id: main.id,
      summary: main.summary || main.id,
      backgroundColor: main.backgroundColor,
      accessRole: "owner",
      isMain: true,
      selected: true,
    });
  }
  for (const v of visible) {
    if (main?.id && v.id === main.id) continue;
    items.push({
      id: v.id,
      summary: v.summary,
      backgroundColor: v.backgroundColor,
      accessRole: v.accessRole,
      isMain: false,
      selected: true,
    });
  }
  return items;
}

/** Extra calendar ids currently selected (excludes main). */
export function selectedExtraIds(items: CalendarLegendItem[]): string[] {
  return items.filter((i) => i.selected && !i.isMain).map((i) => i.id);
}

export function CalendarMyCalendarsList({ items, editable, calendarErrors, onToggle, disabled }: ListProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {t("calendar.myCalendars")}
      </div>
      <ul className="space-y-1.5">
        {items.map((item) => {
          const readOnly = !item.isMain && !isWritableAccessRole(item.accessRole);
          return (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              {editable && !item.isMain ? (
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 accent-[var(--color-primary)]"
                  checked={item.selected}
                  disabled={disabled}
                  onChange={(e) => onToggle?.(item.id, e.target.checked)}
                  aria-label={item.summary}
                />
              ) : (
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0"
                  checked
                  disabled
                  readOnly
                  aria-label={item.summary}
                />
              )}
              <span
                className="size-2.5 shrink-0 rounded-full border border-black/10"
                style={{ backgroundColor: item.backgroundColor || "#7986cb" }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate" title={item.summary}>
                {item.summary}
              </span>
              {readOnly ? <Eye className="text-muted-foreground size-3.5 shrink-0" aria-hidden /> : null}
            </li>
          );
        })}
      </ul>
      {calendarErrors && calendarErrors.length > 0 ? (
        <p className="text-amber-700 dark:text-amber-400 text-xs">
          {t("calendar.calendarErrors", { count: calendarErrors.length })}
        </p>
      ) : null}
    </div>
  );
}

type PanelProps = {
  items: CalendarLegendItem[];
  editable: boolean;
  calendarErrors?: GoogleCalendarErrorEntry[];
  onToggleExtra: (nextExtraIds: string[]) => void;
  disabled?: boolean;
  isDesktop: boolean;
};

export function CalendarMyCalendarsPanel({
  items,
  editable,
  calendarErrors,
  onToggleExtra,
  disabled,
  isDesktop,
}: PanelProps) {
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [localItems, setLocalItems] = useState(items);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevIdsRef = useRef<string>(JSON.stringify(selectedExtraIds(items)));

  useEffect(() => {
    setLocalItems(items);
    prevIdsRef.current = JSON.stringify(selectedExtraIds(items));
  }, [items]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const list = useMemo(
    () => (
      <CalendarMyCalendarsList
        items={localItems}
        editable={editable}
        calendarErrors={calendarErrors}
        disabled={disabled}
        onToggle={(calendarId, nextSelected) => {
          setLocalItems((prev) => {
            const next = prev.map((it) => (it.id === calendarId ? { ...it, selected: nextSelected } : it));
            const nextIds = selectedExtraIds(next);
            const serialized = JSON.stringify(nextIds);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
              if (serialized !== prevIdsRef.current) {
                prevIdsRef.current = serialized;
                onToggleExtra(nextIds);
              }
            }, 400);
            return next;
          });
        }}
      />
    ),
    [localItems, editable, calendarErrors, disabled, onToggleExtra],
  );

  if (isDesktop) {
    return <aside className="w-[240px] shrink-0 pr-3">{list}</aside>;
  }

  return (
    <>
      <Button size="sm" variant="outline" type="button" onClick={() => setSheetOpen(true)}>
        <CalendarRange className="size-4" />
        {t("calendar.calendarsButton")}
      </Button>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="left" className="w-[min(100%,320px)] sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>{t("calendar.myCalendars")}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 px-1">{list}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Pure: compute next visible ids after a checkbox toggle (for tests). */
export function nextVisibleIdsAfterToggle(
  currentExtraIds: string[],
  toggledId: string,
  nextSelected: boolean,
  mainId: string,
): string[] {
  const set = new Set(currentExtraIds.filter((id) => id !== mainId));
  if (nextSelected) set.add(toggledId);
  else set.delete(toggledId);
  return [...set].slice(0, 9);
}
