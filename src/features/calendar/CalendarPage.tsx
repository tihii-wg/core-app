import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import type { DateSelectArg, EventClickArg, EventDropArg, DatesSetArg } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import ruLocale from "@fullcalendar/core/locales/ru";
import roLocale from "@fullcalendar/core/locales/ro";
import enGbLocale from "@fullcalendar/core/locales/en-gb";
import { CalendarDays, CloudOff } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../pages/PageHeader";
import { Spinner } from "../../ui/Spinner";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Switch } from "../../ui/Switch";
import { Label } from "../../ui/Label";
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
  useRefreshGoogleCalendar,
  useSelectGoogleCalendar,
  useSetVisibleGoogleCalendars,
  useUpdateGoogleCalendarEvent,
} from "./useGoogleCalendar";
import { CalendarEventDialog, type CalendarEventDraft } from "./CalendarEventDialog";
import {
  buildMemberLegendItems,
  buildOwnerCalendarItems,
  CalendarMyCalendarsPanel,
} from "./CalendarMyCalendars";
import { CalendarVisibilitySettings } from "./CalendarVisibilitySettings";
import { composeFullCalendarEventId } from "./gcalColors";
import { fullCalendarDateToGoogle, mapGoogleEventsToFc, mapOrdersToFcOverlay } from "./calendarEventMapping";
import type { GoogleCalendarEvent } from "../../services/apiGoogleCalendar";

function fcLocale(lang: string) {
  if (lang.startsWith("ru")) return ruLocale;
  if (lang.startsWith("ro")) return roLocale;
  return enGbLocale;
}

function rangeIso(start: Date, end: Date) {
  return { from: start.toISOString(), to: end.toISOString() };
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
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isMobile = useMediaQuery("(max-width: 639px)");
  const status = statusQuery.data;
  const connected = Boolean(status?.connected);
  const canAccess = Boolean(isOwner || status?.canAccess || status?.teamAccess);
  const calendarsQuery = useGoogleCalendarList(Boolean(connected && canAccess && isOwner));
  const [showOrders, setShowOrders] = useState(false);
  const syncOrdersOn = Boolean(status?.syncOrders);
  const showOverlayToggle = connected && canAccess && !syncOrdersOn;
  const { orders } = useGetOrders("", { enabled: showOverlayToggle && showOrders });
  const [range, setRange] = useState(() => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    return rangeIso(start, end);
  });
  const eventsQuery = useGoogleCalendarEvents(
    range.from,
    range.to,
    Boolean(connected && canAccess),
  );
  const [draft, setDraft] = useState<CalendarEventDraft | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const calendarRef = useRef<InstanceType<typeof FullCalendar> | null>(null);
  const handledOauth = useRef<string | null>(null);

  const reconnectRequired = Boolean(status?.reconnectRequired);
  const timeZone = workspace?.timezone?.trim() || status?.calendarTimeZone || undefined;
  const eventsPayload = eventsQuery.data;
  const gcalRaw = eventsPayload?.events ?? [];
  const calendarErrors = eventsPayload?.calendarErrors ?? [];

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

  const onDatesSet = useCallback((arg: DatesSetArg) => {
    setRange(rangeIso(arg.start, arg.end));
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

  const myCalendarsPanel = connected && canAccess ? (
    <CalendarMyCalendarsPanel
      items={myCalendarItems}
      editable={isOwner}
      calendarErrors={calendarErrors}
      disabled={busy || setVisible.isPending}
      isDesktop={isDesktop}
      onToggleExtra={(ids) => {
        setVisible.mutate(ids, {
          onError: () => {
            void calendarsQuery.refetch();
            void refresh();
          },
        });
      }}
    />
  ) : null;

  return (
    <div className="space-y-4">
      <PageHeader title={t("calendar.title")} description={t("calendar.description")} />

      {!statusQuery.data && !statusQuery.isError ? (
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
              <Button
                disabled={busy}
                onClick={() => connect.mutate(i18n.language || "en")}
              >
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              <div className="text-foreground truncate font-medium">
                {status?.calendarSummary || t("calendar.title")}
              </div>
              <div className="text-muted-foreground truncate">{status?.googleEmail}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!isDesktop ? myCalendarsPanel : null}
              {showOverlayToggle ? (
                <div className="flex items-center gap-2 pr-2">
                  <Switch id="gcal-orders" checked={showOrders} onCheckedChange={setShowOrders} />
                  <Label htmlFor="gcal-orders">{t("calendar.showOrders")}</Label>
                </div>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => openCreate(new Date().toISOString(), new Date(Date.now() + 3600000).toISOString(), false)}>
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

          {pickerOpen && isOwner ? (
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
                      <span>
                        {c.summary}
                        {c.primary ? " ★" : ""}
                      </span>
                      {c.id === status?.calendarId ? (
                        <span className="text-muted-foreground text-xs">{t("calendar.confirmSelect")}</span>
                      ) : null}
                    </button>
                  ))}
              </CardContent>
            </Card>
          ) : null}

          <div className={isDesktop ? "flex items-start gap-0" : undefined}>
            {isDesktop ? myCalendarsPanel : null}
            <div className="bg-card gcal-fullcalendar min-w-0 flex-1 overflow-hidden rounded-lg border p-2 sm:p-3">
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
                initialView={isMobile ? "timeGridDay" : "timeGridWeek"}
                headerToolbar={{
                  left: "prev,next today",
                  center: "title",
                  right: isMobile ? "timeGridDay,listWeek" : "dayGridMonth,timeGridWeek,timeGridDay",
                }}
                buttonText={{
                  month: t("calendar.views.month"),
                  week: t("calendar.views.week"),
                  day: t("calendar.views.day"),
                  list: t("calendar.views.list"),
                }}
                locale={fcLocale(i18n.language || "en")}
                firstDay={1}
                timeZone="local"
                nowIndicator
                scrollTime="08:00:00"
                selectable
                editable
                eventStartEditable
                eventDurationEditable
                selectMirror
                slotEventOverlap={false}
                height={isMobile ? "max(520px, calc(100dvh - 120px))" : "max(640px, calc(100vh - 150px))"}
                events={fcEvents}
                datesSet={onDatesSet}
                select={onSelect}
                eventClick={onEventClick}
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
          </div>

          {isOwner ? <CalendarVisibilitySettings /> : null}
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
