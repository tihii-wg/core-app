import type { TFunction } from "i18next";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { cn } from "../../lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { Order } from "../../lib/types";
import type { OrderListKind } from "../../services/apiOrders";
import { getOrders } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useRealtimeHotQueryOptions } from "../realtime/useRealtimeHotQueryOptions";
import { isOrderOverdue, matchesDeadlineFilter, type DeadlineFilter } from "./orderVisibility";
import { industryProfile } from "../industries/industryProfile";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import {
  bucketOrderCalendarEvents,
  calendarRange,
  calendarWeeks,
  countCalendarEventsInRange,
  dateFromKey,
  isInAnchorMonth,
  readOrderCalendarScale,
  shiftCalendarAnchor,
  writeOrderCalendarScale,
  type OrderCalendarEvent,
  type OrderCalendarEventKind,
  type OrderCalendarScale,
} from "./orderCalendar";

type OrdersCalendarProps = {
  /** Debounced search text (same box as the table). */
  search: string;
  employeeFilter: string;
  deadlineFilter: DeadlineFilter;
  /** Local YYYY-MM-DD. */
  today: string;
  formatMoney: (amount: number) => string;
  onOpenOrder: (order: Order) => void;
  kind?: OrderListKind;
};

const MONTH_CELL_LIMIT = 3;

/**
 * Orders calendar: a plain CSS grid (month or week) listing each order on its deadline,
 * falling back to its creation date when it has no deadline. Clicking an order opens the detail panel.
 */
export function OrdersCalendar({
  search,
  employeeFilter,
  deadlineFilter,
  today,
  formatMoney,
  onOpenOrder,
  kind = "order",
}: OrdersCalendarProps) {
  const { t, i18n } = useTranslation();
  const { profile, industrySlug } = useIndustryWorkflow();
  const industryBlocks = profile?.orderFieldBlocks ?? industryProfile(industrySlug).orderFieldBlocks;
  const { workspaceId } = useActiveWorkspaceId();
  const hot = useRealtimeHotQueryOptions();
  const isEstimates = kind === "estimate";
  const {
    data: orders = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["orders", workspaceId, search, kind],
    queryFn: () => getOrders(workspaceId, search, kind),
    enabled: Boolean(workspaceId),
    ...hot,
  });
  const [scale, setScale] = useState<OrderCalendarScale>(() => readOrderCalendarScale());
  const [anchor, setAnchor] = useState(() => dateFromKey(today) ?? new Date());
  const [expandedDays, setExpandedDays] = useState<ReadonlySet<string>>(() => new Set());

  const visibleOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          (employeeFilter === "all" || order.assignedEmployeeId === employeeFilter) &&
          (isEstimates || matchesDeadlineFilter(order, deadlineFilter, today)),
      ),
    [orders, employeeFilter, deadlineFilter, today, isEstimates],
  );

  const buckets = useMemo(
    () => bucketOrderCalendarEvents(visibleOrders, industryBlocks),
    [visibleOrders, industryBlocks],
  );
  const weeks = useMemo(() => calendarWeeks(anchor, scale), [anchor, scale]);
  const range = useMemo(() => calendarRange(anchor, scale), [anchor, scale]);
  const inRangeCount = countCalendarEventsInRange(buckets, range);

  const locale = i18n.language || "en";
  const titleFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, scale === "month" ? { month: "long", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" }),
    [locale, scale],
  );
  const weekdayFormat = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "short" }), [locale]);
  const dayFormat = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }), [locale]);

  const title = useMemo(() => {
    if (scale === "month") return titleFormat.format(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    const first = dateFromKey(range.from);
    const last = dateFromKey(range.to);
    return first && last ? `${titleFormat.format(first)} – ${titleFormat.format(last)}` : "";
  }, [anchor, range, scale, titleFormat]);

  function changeScale(next: OrderCalendarScale) {
    setScale(next);
    writeOrderCalendarScale(next);
  }

  function toggleDay(dateKey: string) {
    setExpandedDays((current) => {
      const next = new Set(current);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  }

  if (error) {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <ErrorState title={t("orders.empty.loadFailed")} description={error.message} onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="orders-calendar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={scale === "month" ? t("orders.calendar.previousMonth") : t("orders.calendar.previousWeek")}
            onClick={() => setAnchor((current) => shiftCalendarAnchor(current, scale, -1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={scale === "month" ? t("orders.calendar.nextMonth") : t("orders.calendar.nextWeek")}
            onClick={() => setAnchor((current) => shiftCalendarAnchor(current, scale, 1))}
          >
            <ChevronRight />
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setAnchor(dateFromKey(today) ?? new Date())}>
            {t("orders.calendar.today")}
          </Button>
          <h2 className="ml-2 text-sm font-semibold capitalize text-foreground" aria-live="polite">
            {title}
          </h2>
        </div>
        <div role="group" aria-label={t("orders.calendar.scaleLabel")} className="inline-flex h-9 items-center gap-0.5 rounded-lg bg-secondary p-[3px]">
          {(["month", "week"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={scale === option}
              onClick={() => changeScale(option)}
              className={cn(
                "inline-flex h-full cursor-pointer items-center rounded-md px-3 text-[13px] font-medium outline-none transition-[color,background-color,box-shadow] duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/35",
                scale === option ? "bg-card text-foreground shadow-sm dark:bg-muted" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`orders.calendar.scale.${option}`)}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t("orders.calendar.hint")}</p>

      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-xs">
        <div className="min-w-[44rem]" role="grid" aria-label={title}>
          <div className="grid grid-cols-7 border-b border-border bg-muted/50" role="row">
            {weeks[0].map((dateKey) => {
              const date = dateFromKey(dateKey);
              return (
                <div key={dateKey} role="columnheader" className="px-2 py-1.5 text-center text-xs font-medium capitalize text-muted-foreground">
                  {date ? weekdayFormat.format(date) : ""}
                </div>
              );
            })}
          </div>
          {weeks.map((week) => (
            <div key={week[0]} className="grid grid-cols-7 border-b border-border last:border-b-0" role="row">
              {week.map((dateKey) => {
                const dayEvents = buckets.byDate.get(dateKey) ?? [];
                const date = dateFromKey(dateKey);
                const isToday = dateKey === today;
                const dimmed = scale === "month" && !isInAnchorMonth(dateKey, anchor);
                const expanded = scale === "week" || expandedDays.has(dateKey);
                const shown = expanded ? dayEvents : dayEvents.slice(0, MONTH_CELL_LIMIT);
                const hidden = dayEvents.length - shown.length;

                return (
                  <div
                    key={dateKey}
                    role="gridcell"
                    aria-label={date ? dayFormat.format(date) : dateKey}
                    data-date={dateKey}
                    className={cn(
                      "min-w-0 space-y-1 border-r border-border p-1.5 last:border-r-0",
                      scale === "month" ? "min-h-28" : "min-h-64",
                      dimmed && "bg-muted/30",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                          isToday ? "bg-primary font-semibold text-primary-foreground" : dimmed ? "text-subtle-foreground" : "text-muted-foreground",
                        )}
                      >
                        {date?.getDate()}
                      </span>
                      {dayEvents.length > 0 ? <span className="text-[11px] tabular-nums text-subtle-foreground">{dayEvents.length}</span> : null}
                    </div>
                    {shown.map((event) => (
                      <CalendarOrder
                        key={event.id}
                        event={event}
                        overdue={event.kind === "deadline" && isOrderOverdue(event.order, today)}
                        formatMoney={formatMoney}
                        showDetails={scale === "week"}
                        onOpen={onOpenOrder}
                      />
                    ))}
                    {hidden > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggleDay(dateKey)}
                        className="w-full cursor-pointer rounded px-1 py-0.5 text-left text-[11px] font-medium text-primary hover:underline"
                      >
                        {t("orders.calendar.more", { n: hidden })}
                      </button>
                    ) : scale === "month" && expanded && dayEvents.length > MONTH_CELL_LIMIT ? (
                      <button
                        type="button"
                        onClick={() => toggleDay(dateKey)}
                        className="w-full cursor-pointer rounded px-1 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:underline"
                      >
                        {t("orders.calendar.less")}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {inRangeCount === 0 ? <p className="text-xs text-muted-foreground">{t("orders.calendar.emptyRange")}</p> : null}

      {buckets.undated.length > 0 ? (
        <section className="space-y-2" aria-label={t("orders.calendar.undated")}>
          <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">
            {t("orders.calendar.undated")} ({buckets.undated.length})
          </h3>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {buckets.undated.map((event) => (
              <CalendarOrder
                key={event.id}
                event={event}
                overdue={false}
                formatMoney={formatMoney}
                showDetails
                onOpen={onOpenOrder}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

type CalendarOrderProps = {
  event: OrderCalendarEvent<Order>;
  overdue: boolean;
  formatMoney: (amount: number) => string;
  showDetails: boolean;
  onOpen: (order: Order) => void;
};

function calendarEventKindLabel(kind: OrderCalendarEventKind, t: TFunction): string | null {
  if (kind === "measurement") return t("orders.calendar.measurementMarker");
  if (kind === "installation") return t("orders.calendar.installationMarker");
  if (kind === "createdAt") return t("orders.calendar.createdMarker");
  return null;
}

function CalendarOrder({ event, overdue, formatMoney, showDetails, onOpen }: CalendarOrderProps) {
  const { t } = useTranslation();
  const order = event.order;
  const kindLabel = calendarEventKindLabel(event.kind, t);
  const label = kindLabel
    ? `${kindLabel} · ${order.orderNumber} · ${order.clientName || ""}`.trim()
    : t("orders.board.openOrder", { number: order.orderNumber });
  const byCreation = event.kind === "createdAt";
  const isAppointment = event.kind === "measurement" || event.kind === "installation";

  return (
    <button
      type="button"
      aria-label={label}
      title={[kindLabel, order.orderNumber, order.clientName, order.device].filter(Boolean).join(" · ")}
      onClick={() => onOpen(order)}
      className={cn(
        "block w-full min-w-0 cursor-pointer rounded-md border px-1.5 py-1 text-left text-xs outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/35",
        overdue ? "border-destructive/40 bg-destructive/5" : "border-border bg-background",
        byCreation && "border-dashed",
        isAppointment && "border-primary/30 bg-primary/5",
      )}
    >
      {kindLabel && isAppointment ? (
        <span className="block truncate text-[10px] font-medium uppercase tracking-wide text-primary">{kindLabel}</span>
      ) : null}
      <span className="flex items-center justify-between gap-1">
        <span className="truncate font-semibold tabular-nums text-primary">{order.orderNumber || "—"}</span>
        {showDetails && !isAppointment ? <span className="shrink-0 tabular-nums text-foreground">{formatMoney(order.totalPrice)}</span> : null}
      </span>
      <span className="block truncate text-muted-foreground">{order.clientName || "—"}</span>
      {showDetails && order.device ? <span className="block truncate text-muted-foreground">{order.device}</span> : null}
      {byCreation ? <span className="block text-[10px] uppercase tracking-wide text-subtle-foreground">{t("orders.calendar.createdMarker")}</span> : null}
    </button>
  );
}
