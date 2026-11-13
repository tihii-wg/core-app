import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import type {
  DateSelectArg,
  EventClickArg,
  EventDropArg,
  DatesSetArg,
  DayHeaderContentArg,
  EventMountArg,
} from "@fullcalendar/core";
import type { DateClickArg, EventResizeDoneArg } from "@fullcalendar/interaction";
import ruLocale from "@fullcalendar/core/locales/ru";
import roLocale from "@fullcalendar/core/locales/ro";
import enGbLocale from "@fullcalendar/core/locales/en-gb";
import { CalendarDays, CloudOff, Plus, Settings2 } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../pages/PageHeader";
import { Spinner } from "../../ui/Spinner";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Switch } from "../../ui/Switch";
import { Label } from "../../ui/Label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { useConfirm } from "../../ui/ConfirmProvider";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useIsWorkspaceOwnerId } from "../workspaces/useIsWorkspaceOwnerId";
import { useGetOrders } from "../orders/useGetOrders";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useOrderDetails } from "../orders/useOrderDetails";
import OrderDetailPanel from "../orders/OrderDetailPanel";
import { findCachedOrder } from "../orders/useGetOrders";
import { getOrder } from "../../services/apiOrders";
import { useQueryClient } from "@tanstack/react-query";
import {
  useConnectGoogleCalendar,
  useCreateGoogleCalendarEvent,
  useDeleteGoogleCalendarEvent,
  useDisconnectGoogleCalendar,
  useGoogleCalendarEvents,
  useGoogleCalendarList,
  useGoogleCalendarStatus,
  useMoveGoogleCalendarEvent,
  usePrefetchGoogleCalendarEvents,
  useRefreshGoogleCalendar,
  useSelectGoogleCalendar,
  useSetVisibleGoogleCalendars,
  useUpdateGoogleCalendarEvent,
} from "./useGoogleCalendar";
import { peekAdjacentActiveRange } from "./calendarPrefetch";
import { initialVisibleRange, rangeIso } from "./calendarVisibleRange";
import { CalendarEventDialog, type CalendarEventDraft } from "./CalendarEventDialog";
import {
  buildMemberLegendItems,
  buildOwnerCalendarItems,
  CalendarColorDots,
  CalendarMyCalendarsPanel,
} from "./CalendarMyCalendars";
import { CalendarVisibilitySettings } from "./CalendarVisibilitySettings";
import { CalendarViewSwitcher } from "./CalendarViewSwitcher";
import { draftFromDateClick } from "./calendarDateClick";
import {
  decideCalendarSwipe,
  isEventTargetElement,
  isFullCalendarBusy,
  type SwipePointerSample,
} from "./calendarSwipe";
import { composeFullCalendarEventId } from "./gcalColors";
import { fullCalendarDateToGoogle, mapGoogleEventsToFc, mapOrdersToFcOverlay } from "./calendarEventMapping";
import {
  readStoredGcalView,
  writeStoredGcalView,
  type GcalViewId,
} from "./calendarViewStorage";
import type { GoogleCalendarEvent } from "../../services/apiGoogleCalendar";

function fcLocale(lang: string) {
  if (lang.startsWith("ru")) return ruLocale;
  if (lang.startsWith("ro")) return roLocale;
  return enGbLocale;
}

export function CalendarPage() {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOwner = useIsWorkspaceOwnerId();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const { profile } = useIndustryWorkflow();
  const orderDetails = useOrderDetails();
  const statusQuery = useGoogleCalendarStatus();
  const connect = useConnectGoogleCalendar();
  const disconnect = useDisconnectGoogleCalendar();
  const selectCalendar = useSelectGoogleCalendar();
  const setVisible = useSetVisibleGoogleCalendars();
  const createEvent = useCreateGoogleCalendarEvent();
  const updateEvent = useUpdateGoogleCalendarEvent();
  const deleteEvent = useDeleteGoogleCalendarEvent();
  const moveEvent = useMoveGoogleCalendarEvent();
  const refresh = useRefreshGoogleCalendar();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calendarsSheetOpen, setCalendarsSheetOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isMobile = useMediaQuery("(max-width: 639px)");
  const isCoarsePointer = useMediaQuery("(pointer: coarse)");
  const status = statusQuery.data;
  const statusSettled = statusQuery.isFetched || statusQuery.isError;
  const connected = Boolean(status?.connected);
  const canAccess = Boolean(isOwner || status?.canAccess || status?.teamAccess);
  const reconnectRequired = Boolean(status?.reconnectRequired);
  // Start events/calendars in parallel with status; hide results if status says disconnected.
  const connectionOk = connected && canAccess && !reconnectRequired;
  const eventsEnabled = Boolean(workspaceId) && (!statusSettled || connectionOk);
  const calendarsQuery = useGoogleCalendarList(
    Boolean(workspaceId) && isOwner && (!statusSettled || connectionOk),
  );
  const [showOrders, setShowOrders] = useState(false);
  const syncOrdersOn = Boolean(status?.syncOrders);
  const showOverlayToggle = connectionOk && !syncOrdersOn;
  const { orders } = useGetOrders("", { enabled: showOverlayToggle && showOrders });
  const [activeView, setActiveView] = useState<GcalViewId>(() => readStoredGcalView(false));
  const [range, setRange] = useState(() => initialVisibleRange(readStoredGcalView(false)));
  const eventsQuery = useGoogleCalendarEvents(range.from, range.to, eventsEnabled);
  const prefetchEvents = usePrefetchGoogleCalendarEvents();
  const [draft, setDraft] = useState<CalendarEventDraft | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const calendarRef = useRef<InstanceType<typeof FullCalendar> | null>(null);
  const calendarShellRef = useRef<HTMLDivElement | null>(null);
  const handledOauth = useRef<string | null>(null);
  const swipeStartRef = useRef<(SwipePointerSample & { startedOnEvent: boolean; pointerId: number }) | null>(
    null,
  );
  const swipeCommittedRef = useRef(false);
  /** After a committed swipe, ignore the tap/click FullCalendar may emit on finger-up. */
  const suppressTapUntilRef = useRef(0);
  const swipeRafRef = useRef<number | null>(null);
  const swipeLatestRef = useRef<SwipePointerSample | null>(null);
  const peekingRangeRef = useRef(false);
  const activePointersRef = useRef(new Set<number>());
  const initialViewApplied = useRef(false);
  const overlayOpenRef = useRef(false);

  // Sync default/stored view once we know the breakpoint.
  useEffect(() => {
    if (initialViewApplied.current) return;
    initialViewApplied.current = true;
    const stored = readStoredGcalView(isMobile);
    setActiveView(stored);
  }, [isMobile]);

  const timeZone = workspace?.timezone?.trim() || status?.calendarTimeZone || undefined;
  // Discard optimistic event results when status says not connected / no access.
  const eventsPayload = connectionOk ? eventsQuery.data : undefined;
  const gcalRaw = eventsPayload?.events ?? [];
  const calendarErrors = eventsPayload?.calendarErrors ?? [];
  // Lightweight in-grid hint only while showing a previous range or first load — never block swipe.
  const eventsLoading = Boolean(
    connectionOk && (eventsQuery.isPending || eventsQuery.isPlaceholderData),
  );
  overlayOpenRef.current = dialogOpen || settingsOpen || calendarsSheetOpen || pickerOpen;

  // Prefetch neighbouring periods only after the visible range has resolved (not competing with first paint).
  const visibleEventsReady = connectionOk && eventsQuery.isFetched && !eventsQuery.isPending;
  useEffect(() => {
    if (!visibleEventsReady) return;
    const api = calendarRef.current?.getApi();
    if (!api) return;
    peekingRangeRef.current = true;
    try {
      const prev = peekAdjacentActiveRange(api, "prev");
      const next = peekAdjacentActiveRange(api, "next");
      if (prev) prefetchEvents(prev.from, prev.to);
      if (next) prefetchEvents(next.from, next.to);
    } finally {
      peekingRangeRef.current = false;
    }
  }, [visibleEventsReady, range.from, range.to, prefetchEvents, activeView]);

  useEffect(() => {
    const gcal = searchParams.get("gcal");
    const gcalError = searchParams.get("gcal_error");
    if (gcal !== "connected" && !gcalError) return;
    const marker = gcalError ? `err:${gcalError}` : "connected";
    if (handledOauth.current !== marker) {
      handledOauth.current = marker;
      if (gcal === "connected") toast.success(t("calendar.toast.connected"));
      else {
        toast.error(
          gcalError ? t("calendar.toast.oauthError", { code: gcalError }) : t("calendar.toast.oauthErrorGeneric"),
        );
      }
      void refresh();
    }
    const next = new URLSearchParams(searchParams);
    next.delete("gcal");
    next.delete("gcal_error");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const gcalEvents = useMemo(
    () =>
      mapGoogleEventsToFc(gcalRaw, t("calendar.busy")).map((ev) =>
        ev.title === "(no title)" ? { ...ev, title: t("calendar.untitled") } : ev,
      ),
    [gcalRaw, t],
  );
  const orderEvents = useMemo(() => {
    if (!showOverlayToggle || !showOrders || !orders.length) return [];
    return mapOrdersToFcOverlay(orders, {
      measurementAt: Boolean(profile?.orderFieldBlocks?.measurementAt),
      installationAt: Boolean(profile?.orderFieldBlocks?.installationAt),
    });
  }, [showOverlayToggle, showOrders, orders, profile]);

  const fcEvents = useMemo(() => [...gcalEvents, ...orderEvents], [gcalEvents, orderEvents]);

  const eventByFcId = useMemo(() => {
    const map = new Map<string, GoogleCalendarEvent>();
    for (const ev of gcalRaw) {
      const calId = ev.calendarId?.trim() || "";
      const key = calId ? composeFullCalendarEventId(calId, ev.id) : ev.id;
      map.set(key, ev);
    }
    return map;
  }, [gcalRaw]);

  const myCalendarItems = useMemo(() => {
    if (isOwner && calendarsQuery.data) {
      return buildOwnerCalendarItems(calendarsQuery.data, status?.calendarId);
    }
    return buildMemberLegendItems(status?.mainCalendar, status?.visibleCalendars ?? []);
  }, [isOwner, calendarsQuery.data, status?.calendarId, status?.mainCalendar, status?.visibleCalendars]);

  const calendarOptions = useMemo(
    () =>
      myCalendarItems.map((c) => ({
        id: c.id,
        summary: c.summary,
        accessRole: c.accessRole,
        isMain: c.isMain,
      })),
    [myCalendarItems],
  );

  const calendarNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of myCalendarItems) map[c.id] = c.summary;
    return map;
  }, [myCalendarItems]);

  const changeView = useCallback((view: GcalViewId) => {
    const api = calendarRef.current?.getApi();
    if (api) api.changeView(view);
    setActiveView(view);
    writeStoredGcalView(view);
  }, []);

  const onDatesSet = useCallback((arg: DatesSetArg) => {
    // Ignore synthetic prev/next used only to peek adjacent ranges for prefetch.
    if (peekingRangeRef.current) return;
    // Update range immediately so the grid period changes without waiting on fetch.
    setRange((prev) => {
      const next = rangeIso(arg.start, arg.end);
      if (prev.from === next.from && prev.to === next.to) return prev;
      return next;
    });
    const type = arg.view.type;
    if (type) {
      setActiveView((prev) => {
        if (prev === type) return prev;
        writeStoredGcalView(type);
        return type as GcalViewId;
      });
    }
  }, []);

  function openCreate(start: string, end: string, allDay: boolean) {
    setDraft({
      mode: "create",
      title: "",
      description: "",
      location: "",
      start,
      end,
      allDay,
      calendarId: status?.calendarId ?? null,
    });
    setDialogOpen(true);
  }

  function openEdit(event: GoogleCalendarEvent) {
    const viewOnly = Boolean(event.readOnly || event.busyOnly);
    setDraft({
      mode: viewOnly ? "view" : "edit",
      event,
      title: event.busyOnly ? t("calendar.busy") : event.title,
      description: event.description ?? "",
      location: event.location ?? "",
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      calendarId: event.calendarId,
    });
    setDialogOpen(true);
  }

  function onSelect(arg: DateSelectArg) {
    if (!connected) return;
    const mapped = fullCalendarDateToGoogle(arg.start, arg.end, arg.allDay);
    openCreate(mapped.start, mapped.end, mapped.allDay);
    arg.view.calendar.unselect();
  }

  function onDateClick(arg: DateClickArg) {
    if (!connected) return;
    if (Date.now() < suppressTapUntilRef.current) return;
    // Touch taps use dateClick (select needs long-press). Mouse create stays on select/drag.
    if (!isCoarsePointer && !isMobile) return;
    const draftRange = draftFromDateClick({
      date: arg.date,
      allDay: arg.allDay,
      viewType: arg.view.type,
    });
    openCreate(draftRange.start, draftRange.end, draftRange.allDay);
  }

  function onMoreLinkClick(arg: { date: Date; allDay: boolean }) {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    api.changeView("timeGridDay", arg.date);
    setActiveView("timeGridDay");
    writeStoredGcalView("timeGridDay");
  }

  function onEventDidMount(info: EventMountArg) {
    if (info.event.allDay || !info.event.start || !info.event.end) return;
    const mins = (info.event.end.getTime() - info.event.start.getTime()) / 60_000;
    if (mins >= 45) return;
    const timeEl = info.el.querySelector(".fc-event-time");
    if (timeEl instanceof HTMLElement) timeEl.style.display = "none";
  }

  async function openOrderById(orderId: string) {
    const cached = findCachedOrder(queryClient, workspaceId, orderId);
    if (cached) {
      orderDetails.openOrder(cached);
      return;
    }
    try {
      const order = await getOrder(orderId, workspaceId);
      if (order) orderDetails.openOrder(order);
    } catch {
      // ignore — order may have been deleted
    }
  }

  function onEventClick(arg: EventClickArg) {
    if (Date.now() < suppressTapUntilRef.current) {
      arg.jsEvent.preventDefault();
      return;
    }
    const kind = arg.event.extendedProps.kind;
    if (kind === "order" || kind === "order_sync") {
      const orderId = (arg.event.extendedProps.orderId || arg.event.extendedProps.coreAppOrderId) as string;
      if (orderId) void openOrderById(orderId);
      return;
    }
    const ev = eventByFcId.get(arg.event.id);
    if (ev?.coreAppOrderId) {
      void openOrderById(ev.coreAppOrderId);
      return;
    }
    if (ev) openEdit(ev);
  }

  async function onEventDrop(arg: EventDropArg) {
    if (arg.event.extendedProps.kind === "order" || arg.event.extendedProps.kind === "order_sync") {
      arg.revert();
      return;
    }
    const ev = eventByFcId.get(arg.event.id);
    if (!ev?.etag || !ev.calendarId || ev.coreAppOrderId || ev.readOnly || ev.busyOnly) {
      arg.revert();
      return;
    }
    const mapped = fullCalendarDateToGoogle(arg.event.start!, arg.event.end, arg.event.allDay);
    try {
      await updateEvent.mutateAsync({
        eventId: ev.id,
        input: {
          title: ev.title,
          description: ev.description,
          location: ev.location,
          start: mapped.start,
          end: mapped.end,
          allDay: mapped.allDay,
          timeZone,
          etag: ev.etag,
          calendarId: ev.calendarId,
        },
      });
    } catch {
      arg.revert();
    }
  }

  async function onEventResize(arg: EventResizeDoneArg) {
    if (arg.event.extendedProps.kind === "order" || arg.event.extendedProps.kind === "order_sync") {
      arg.revert();
      return;
    }
    const ev = eventByFcId.get(arg.event.id);
    if (!ev?.etag || !ev.calendarId || ev.coreAppOrderId || ev.readOnly || ev.busyOnly) {
      arg.revert();
      return;
    }
    const mapped = fullCalendarDateToGoogle(arg.event.start!, arg.event.end, arg.event.allDay);
    try {
      await updateEvent.mutateAsync({
        eventId: ev.id,
        input: {
          title: ev.title,
          description: ev.description,
          location: ev.location,
          start: mapped.start,
          end: mapped.end,
          allDay: mapped.allDay,
          timeZone,
          etag: ev.etag,
          calendarId: ev.calendarId,
        },
      });
    } catch {
      arg.revert();
    }
  }

  function playSwipeHint(direction: "prev" | "next") {
    // Non-blocking CSS hint — never await this before navigating.
    const harness = calendarShellRef.current?.querySelector(".fc-view-harness");
    if (!(harness instanceof HTMLElement)) return;
    const cls = direction === "prev" ? "gcal-swipe-prev" : "gcal-swipe-next";
    harness.classList.remove("gcal-swipe-prev", "gcal-swipe-next");
    // Double-rAF restarts the transition without a synchronous layout read.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        harness.classList.add(cls);
        window.setTimeout(() => harness.classList.remove(cls), 160);
      });
    });
  }

  const navigateBySwipe = useCallback((decision: "prev" | "next") => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    // Optimistic: change the visible period immediately; events load via React Query.
    if (decision === "next") api.next();
    else api.prev();
    playSwipeHint(decision);
  }, []);

  const tryCommitSwipe = useCallback(
    (end: SwipePointerSample, pointerCount: number) => {
      if (swipeCommittedRef.current) return;
      const start = swipeStartRef.current;
      if (!start) return;
      const decision = decideCalendarSwipe(start, end, {
        startedOnEvent: start.startedOnEvent,
        pointerCount,
        fcBusy: isFullCalendarBusy(calendarShellRef.current),
        blocked: overlayOpenRef.current,
      });
      if (!decision) return;
      swipeCommittedRef.current = true;
      swipeStartRef.current = null;
      suppressTapUntilRef.current = Date.now() + 500;
      navigateBySwipe(decision);
    },
    [navigateBySwipe],
  );

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Desktop mouse drag-select / resize must not trigger period swipes.
    if (e.pointerType === "mouse") return;
    activePointersRef.current.add(e.pointerId);
    if (!e.isPrimary) return;
    if (swipeRafRef.current != null) {
      cancelAnimationFrame(swipeRafRef.current);
      swipeRafRef.current = null;
    }
    swipeCommittedRef.current = false;
    swipeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      pointerId: e.pointerId,
      startedOnEvent: isEventTargetElement(e.target),
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse") return;
    const start = swipeStartRef.current;
    if (!start || start.pointerId !== e.pointerId || swipeCommittedRef.current) return;
    swipeLatestRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    // Cheap: at most one decide per animation frame — no React state per pixel.
    if (swipeRafRef.current != null) return;
    swipeRafRef.current = requestAnimationFrame(() => {
      swipeRafRef.current = null;
      const sample = swipeLatestRef.current;
      if (!sample) return;
      tryCommitSwipe(sample, activePointersRef.current.size);
    });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse") return;
    const pointerCount = activePointersRef.current.size;
    activePointersRef.current.delete(e.pointerId);
    if (swipeRafRef.current != null) {
      cancelAnimationFrame(swipeRafRef.current);
      swipeRafRef.current = null;
    }
    const start = swipeStartRef.current;
    if (!start || start.pointerId !== e.pointerId) {
      if (swipeCommittedRef.current && start?.pointerId === e.pointerId) {
        swipeCommittedRef.current = false;
      }
      return;
    }
    tryCommitSwipe({ x: e.clientX, y: e.clientY, t: Date.now() }, pointerCount);
    swipeStartRef.current = null;
    swipeCommittedRef.current = false;
  }

  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse") return;
    activePointersRef.current.delete(e.pointerId);
    if (swipeRafRef.current != null) {
      cancelAnimationFrame(swipeRafRef.current);
      swipeRafRef.current = null;
    }
    if (swipeStartRef.current?.pointerId === e.pointerId) swipeStartRef.current = null;
    swipeCommittedRef.current = false;
  }

  async function onDisconnect() {
    const ok = await confirm({
      title: t("calendar.confirmDisconnect.title"),
      description: t("calendar.confirmDisconnect.description"),
      confirmLabel: t("calendar.confirmDisconnect.confirm"),
      tone: "destructive",
      icon: "warning",
    });
    if (!ok) return;
    disconnect.mutate();
    setSettingsOpen(false);
  }

  const busy =
    connect.isPending ||
    disconnect.isPending ||
    selectCalendar.isPending ||
    setVisible.isPending ||
    createEvent.isPending ||
    updateEvent.isPending ||
    deleteEvent.isPending ||
    moveEvent.isPending;

  const onToggleExtra = useCallback(
    (ids: string[]) => {
      setVisible.mutate(ids, {
        onError: () => {
          void calendarsQuery.refetch();
          void refresh();
        },
      });
    },
    [setVisible, calendarsQuery, refresh],
  );

  const myCalendarsPanel = connected && canAccess ? (
    <CalendarMyCalendarsPanel
      items={myCalendarItems}
      editable={isOwner}
      calendarErrors={calendarErrors}
      disabled={busy || setVisible.isPending}
      isDesktop={isDesktop}
      sheetOpen={calendarsSheetOpen}
      onSheetOpenChange={setCalendarsSheetOpen}
      hideTrigger={isMobile}
      onToggleExtra={onToggleExtra}
    />
  ) : null;

  // Google Calendar–style day headers in time-grid views: small weekday + large date (today in a circle).
  const renderDayHeader = useCallback(
    (arg: DayHeaderContentArg) => {
      if (!arg.view.type.startsWith("timeGrid")) return arg.text;
      const weekday = new Intl.DateTimeFormat(i18n.language || "en", { weekday: "short" })
        .format(arg.date)
        .replace(".", "");
      return (
        <div className="gcal-dayhead">
          <span className="gcal-dayhead-wd">{weekday}</span>
          <span className={arg.isToday ? "gcal-dayhead-num is-today" : "gcal-dayhead-num"}>{arg.date.getDate()}</span>
        </div>
      );
    },
    [i18n.language],
  );

  const phoneViews = useMemo(
    () => ({
      timeGrid3Day: {
        type: "timeGrid" as const,
        duration: { days: 3 },
        buttonText: t("calendar.views.threeDays"),
        dayHeaderFormat: { weekday: "short" as const, day: "numeric" as const },
        slotLabelFormat: { hour: "numeric" as const },
      },
      timeGridWeek: {
        dayHeaderFormat: { weekday: "narrow" as const, day: "numeric" as const },
        slotLabelFormat: { hour: "numeric" as const },
      },
      timeGridDay: {
        dayHeaderFormat: { weekday: "short" as const, day: "numeric" as const },
        slotLabelFormat: { hour: "numeric" as const },
      },
      dayGridMonth: {
        dayMaxEvents: 2,
        fixedWeekCount: false,
      },
    }),
    [t],
  );

  const desktopViews = useMemo(
    () => ({
      timeGrid3Day: {
        type: "timeGrid" as const,
        duration: { days: 3 },
        buttonText: t("calendar.views.threeDays"),
      },
    }),
    [t],
  );

  const calendarBlock =
    connected && canAccess ? (
      <div
        ref={calendarShellRef}
        className="bg-card gcal-fullcalendar relative min-w-0 flex-1 overflow-hidden rounded-lg border p-2 sm:p-3"
        data-mobile={isMobile ? "true" : "false"}
        data-coarse={isCoarsePointer ? "true" : "false"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {eventsLoading ? (
          <div className="gcal-events-loading" aria-live="polite">
            <span className="gcal-events-loading-bar" />
            <span className="sr-only">{t("calendar.loadingEvents")}</span>
          </div>
        ) : null}
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
          initialView={activeView}
          headerToolbar={
            isMobile
              ? { left: "prev,next", center: "title", right: "today" }
              : { left: "prev,next today", center: "title", right: "" }
          }
          views={isMobile ? phoneViews : desktopViews}
          locale={fcLocale(i18n.language || "en")}
          firstDay={1}
          timeZone="local"
          nowIndicator
          dayHeaderContent={renderDayHeader}
          scrollTime="08:00:00"
          selectable
          editable
          eventStartEditable
          eventDurationEditable
          selectMirror
          slotEventOverlap={false}
          longPressDelay={350}
          eventLongPressDelay={350}
          selectLongPressDelay={350}
          dayMaxEvents={isMobile ? 2 : true}
          fixedWeekCount={false}
          moreLinkClick={(arg) => {
            onMoreLinkClick({ date: arg.date, allDay: true });
            return "timeGridDay";
          }}
          moreLinkContent={
            isMobile
              ? (arg) => `+ ${t("calendar.moreEvents", { count: arg.num })}`
              : undefined
          }
          height={
            isMobile
              ? "max(480px, calc(100dvh - 210px - env(safe-area-inset-bottom, 0px)))"
              : "max(640px, calc(100vh - 180px))"
          }
          events={fcEvents}
          datesSet={onDatesSet}
          dateClick={onDateClick}
          select={onSelect}
          eventClick={onEventClick}
          eventDidMount={onEventDidMount}
          eventDrop={(arg) => void onEventDrop(arg)}
          eventResize={(arg) => void onEventResize(arg)}
          eventAllow={(_span, moving) => {
            const kind = moving?.extendedProps?.kind;
            if (kind === "order" || kind === "order_sync") return false;
            if (moving?.extendedProps?.readOnly || moving?.extendedProps?.busyOnly) return false;
            return true;
          }}
        />
      </div>
    ) : null;

  return (
    <div className="gcal-page min-w-0 space-y-3 overflow-x-hidden sm:space-y-4">
      {isMobile ? (
        <div className="min-w-0 space-y-1">
          <h1 className="text-foreground text-xl font-semibold tracking-tight">{t("calendar.title")}</h1>
          {connected && canAccess ? (
            <p className="text-muted-foreground truncate text-xs">
              {status?.googleEmail || status?.calendarSummary}
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">{t("calendar.description")}</p>
          )}
        </div>
      ) : (
        <PageHeader title={t("calendar.title")} description={t("calendar.description")} />
      )}

      {!status && !statusQuery.isError && statusQuery.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : !connected ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CloudOff className="size-4" />
              {reconnectRequired
                ? t("calendar.reconnectRequired")
                : isOwner
                  ? t("calendar.connect")
                  : t("calendar.waitingOwner")}
            </CardTitle>
            <CardDescription>
              {isOwner ? t("calendar.connectHint") : t("calendar.waitingOwnerHint")}
            </CardDescription>
          </CardHeader>
          {isOwner ? (
            <CardContent>
              <Button disabled={busy} onClick={() => connect.mutate(i18n.language || "en")}>
                <CalendarDays className="size-4" />
                {reconnectRequired ? t("calendar.reconnect") : t("calendar.connect")}
              </Button>
            </CardContent>
          ) : null}
        </Card>
      ) : !canAccess ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("calendar.ownerOnly.title")}</CardTitle>
            <CardDescription>{t("calendar.ownerOnly.description")}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          {!isMobile ? (
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <div className="text-foreground truncate font-medium">
                  {status?.calendarSummary || t("calendar.title")}
                </div>
                <div className="text-muted-foreground truncate">{status?.googleEmail}</div>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {showOverlayToggle ? (
                  <div className="flex items-center gap-2 pr-2">
                    <Switch id="gcal-orders" checked={showOrders} onCheckedChange={setShowOrders} />
                    <Label htmlFor="gcal-orders">{t("calendar.showOrders")}</Label>
                  </div>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    openCreate(
                      new Date().toISOString(),
                      new Date(Date.now() + 3600000).toISOString(),
                      false,
                    )
                  }
                >
                  {t("calendar.addEvent")}
                </Button>
                {isOwner ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setPickerOpen((v) => !v)}>
                      {t("calendar.changeCalendar")}
                    </Button>
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => void onDisconnect()}>
                      {t("calendar.disconnect")}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                type="button"
                className="min-w-0"
                onClick={() => setCalendarsSheetOpen(true)}
              >
                <CalendarColorDots items={myCalendarItems} />
                <span className="truncate">{t("calendar.calendarsButton")}</span>
              </Button>
              {showOverlayToggle ? (
                <div className="flex min-w-0 items-center gap-2">
                  <Switch id="gcal-orders-m" checked={showOrders} onCheckedChange={setShowOrders} />
                  <Label htmlFor="gcal-orders-m" className="truncate text-xs">
                    {t("calendar.showOrders")}
                  </Label>
                </div>
              ) : null}
              {isOwner ? (
                <Button size="sm" variant="outline" type="button" onClick={() => setSettingsOpen(true)}>
                  <Settings2 className="size-4" />
                  <span className="sr-only sm:not-sr-only sm:inline">{t("calendar.settingsSheet")}</span>
                </Button>
              ) : null}
            </div>
          )}

          <CalendarViewSwitcher activeView={activeView} isMobile={isMobile} onChange={changeView} />

          {pickerOpen && isOwner && !isMobile ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("calendar.selectCalendar")}</CardTitle>
                <CardDescription>{t("calendar.selectCalendarHint")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(calendarsQuery.data ?? [])
                  .filter((c) => c.accessRole === "owner" || c.accessRole === "writer")
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="hover:bg-muted flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm"
                      disabled={busy || c.id === status?.calendarId}
                      onClick={() => {
                        selectCalendar.mutate(c.id, { onSuccess: () => setPickerOpen(false) });
                      }}
                    >
                      <span className="min-w-0 truncate">
                        {c.summary}
                        {c.primary ? " ★" : ""}
                      </span>
                      {c.id === status?.calendarId ? (
                        <span className="text-muted-foreground shrink-0 text-xs">{t("calendar.confirmSelect")}</span>
                      ) : null}
                    </button>
                  ))}
              </CardContent>
            </Card>
          ) : null}

          <div className={isDesktop ? "flex items-start gap-0" : "min-w-0"}>
            {myCalendarsPanel}
            {calendarBlock}
          </div>

          {isOwner && !isMobile ? <CalendarVisibilitySettings /> : null}

          {isMobile ? (
            <Button
              type="button"
              size="icon"
              className="gcal-fab fixed z-40 size-14 rounded-full shadow-lg"
              style={{
                right: "max(1rem, env(safe-area-inset-right))",
                bottom: "max(1rem, env(safe-area-inset-bottom))",
              }}
              aria-label={t("calendar.addEvent")}
              onClick={() =>
                openCreate(new Date().toISOString(), new Date(Date.now() + 3600000).toISOString(), false)
              }
            >
              <Plus className="size-6" />
            </Button>
          ) : null}

          {isOwner ? (
            <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
              <SheetContent
                side="bottom"
                className="max-h-[90dvh] w-full overflow-y-auto rounded-t-xl pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-none"
              >
                <SheetHeader>
                  <SheetTitle>{t("calendar.settingsSheet")}</SheetTitle>
                </SheetHeader>
                <div className="space-y-4 px-5 pb-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">{t("calendar.selectCalendar")}</p>
                    <p className="text-muted-foreground text-xs">{t("calendar.selectCalendarHint")}</p>
                    <div className="space-y-2">
                      {(calendarsQuery.data ?? [])
                        .filter((c) => c.accessRole === "owner" || c.accessRole === "writer")
                        .map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="hover:bg-muted flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm"
                            disabled={busy || c.id === status?.calendarId}
                            onClick={() => {
                              selectCalendar.mutate(c.id, {
                                onSuccess: () => setSettingsOpen(false),
                              });
                            }}
                          >
                            <span className="min-w-0 truncate">
                              {c.summary}
                              {c.primary ? " ★" : ""}
                            </span>
                            {c.id === status?.calendarId ? (
                              <span className="text-muted-foreground shrink-0 text-xs">
                                {t("calendar.confirmSelect")}
                              </span>
                            ) : null}
                          </button>
                        ))}
                    </div>
                  </div>
                  <CalendarVisibilitySettings />
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={busy}
                    onClick={() => void onDisconnect()}
                  >
                    {t("calendar.disconnect")}
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          ) : null}
        </>
      )}

      {orderDetails.panelProps.selectedOrder ? <OrderDetailPanel {...orderDetails.panelProps} /> : null}

      <CalendarEventDialog
        open={dialogOpen}
        draft={draft}
        busy={busy}
        calendarOptions={calendarOptions}
        calendarNameById={calendarNameById}
        onOpenChange={setDialogOpen}
        onSave={(input, meta) => {
          if (draft?.mode === "view") return;
          if (draft?.mode === "edit" && draft.event) {
            if (!input.etag || !input.calendarId) return;
            const fromCal = input.calendarId;
            updateEvent.mutate(
              {
                eventId: draft.event.id,
                input: { ...input, etag: input.etag, calendarId: fromCal },
              },
              {
                onSuccess: () => {
                  const moveTo = meta?.moveToCalendarId;
                  if (moveTo && moveTo !== fromCal) {
                    moveEvent.mutate(
                      {
                        eventId: draft.event!.id,
                        fromCalendarId: fromCal,
                        toCalendarId: moveTo,
                      },
                      {
                        onSuccess: () => {
                          setDialogOpen(false);
                          toast.success(t("calendar.toast.saved"));
                        },
                      },
                    );
                    return;
                  }
                  setDialogOpen(false);
                  toast.success(t("calendar.toast.saved"));
                },
              },
            );
          } else {
            createEvent.mutate(input, { onSuccess: () => setDialogOpen(false) });
          }
        }}
        onDelete={
          draft?.mode === "edit" && draft.event?.calendarId
            ? () => {
                deleteEvent.mutate(
                  { eventId: draft.event!.id, calendarId: draft.event!.calendarId! },
                  { onSuccess: () => setDialogOpen(false) },
                );
              }
            : undefined
        }
      />
    </div>
  );
}
