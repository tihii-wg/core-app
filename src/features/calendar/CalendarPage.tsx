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
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../pages/PageHeader";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Switch } from "../../ui/Switch";
import { Label } from "../../ui/Label";
import { useConfirm } from "../../ui/ConfirmProvider";
import { languageFromPath } from "../../i18n/languages";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useIsWorkspaceOwnerId } from "../workspaces/useIsWorkspaceOwnerId";
import { useGetOrders } from "../orders/useGetOrders";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import {
  useConnectGoogleCalendar,
  useCreateGoogleCalendarEvent,
  useDeleteGoogleCalendarEvent,
  useDisconnectGoogleCalendar,
  useGoogleCalendarEvents,
  useGoogleCalendarList,
  useGoogleCalendarStatus,
  useRefreshGoogleCalendar,
  useSelectGoogleCalendar,
  useUpdateGoogleCalendarEvent,
} from "./useGoogleCalendar";
import { CalendarEventDialog, type CalendarEventDraft } from "./CalendarEventDialog";
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOwner = useIsWorkspaceOwnerId();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const { profile } = useIndustryWorkflow();
  const statusQuery = useGoogleCalendarStatus();
  const connect = useConnectGoogleCalendar();
  const disconnect = useDisconnectGoogleCalendar();
  const selectCalendar = useSelectGoogleCalendar();
  const createEvent = useCreateGoogleCalendarEvent();
  const updateEvent = useUpdateGoogleCalendarEvent();
  const deleteEvent = useDeleteGoogleCalendarEvent();
  const refresh = useRefreshGoogleCalendar();
  const [pickerOpen, setPickerOpen] = useState(false);
  const calendarsQuery = useGoogleCalendarList(pickerOpen && isOwner);
  const [showOrders, setShowOrders] = useState(false);
  const { orders } = useGetOrders("", { enabled: showOrders });
  const [range, setRange] = useState(() => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    return rangeIso(start, end);
  });
  const eventsQuery = useGoogleCalendarEvents(range.from, range.to, Boolean(statusQuery.data?.connected));
  const [draft, setDraft] = useState<CalendarEventDraft | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const calendarRef = useRef<InstanceType<typeof FullCalendar> | null>(null);
  const handledOauth = useRef<string | null>(null);
  const isMobile =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 639px)").matches;

  const status = statusQuery.data;
  const connected = Boolean(status?.connected);
  const reconnectRequired = Boolean(status?.reconnectRequired);
  const timeZone = workspace?.timezone?.trim() || status?.calendarTimeZone || undefined;

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

  const gcalEvents = useMemo(() => mapGoogleEventsToFc(eventsQuery.data ?? []), [eventsQuery.data]);
  const orderEvents = useMemo(() => {
    if (!showOrders || !orders.length) return [];
    return mapOrdersToFcOverlay(orders, {
      measurementAt: Boolean(profile?.orderFieldBlocks?.measurementAt),
      installationAt: Boolean(profile?.orderFieldBlocks?.installationAt),
    });
  }, [showOrders, orders, profile]);

  const fcEvents = useMemo(() => [...gcalEvents, ...orderEvents], [gcalEvents, orderEvents]);

  const eventById = useMemo(() => {
    const map = new Map<string, GoogleCalendarEvent>();
    for (const ev of eventsQuery.data ?? []) map.set(ev.id, ev);
    return map;
  }, [eventsQuery.data]);

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
    });
    setDialogOpen(true);
  }

  function openEdit(event: GoogleCalendarEvent) {
    setDraft({
      mode: "edit",
      event,
      title: event.title,
      description: event.description ?? "",
      location: event.location ?? "",
      start: event.start,
      end: event.end,
      allDay: event.allDay,
    });
    setDialogOpen(true);
  }

  function onSelect(arg: DateSelectArg) {
    if (!connected) return;
    const mapped = fullCalendarDateToGoogle(arg.start, arg.end, arg.allDay);
    openCreate(mapped.start, mapped.end, mapped.allDay);
    arg.view.calendar.unselect();
  }

  function onEventClick(arg: EventClickArg) {
    const kind = arg.event.extendedProps.kind;
    if (kind === "order") {
      const orderId = arg.event.extendedProps.orderId as string;
      const locale = languageFromPath(window.location.pathname);
      navigate(`/${locale}/${workspaceId}/orders`, { state: { openOrderId: orderId } });
      return;
    }
    const ev = eventById.get(arg.event.id);
    if (ev) openEdit(ev);
  }

  async function onEventDrop(arg: EventDropArg) {
    const ev = eventById.get(arg.event.id);
    if (!ev?.etag) {
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
        },
      });
    } catch {
      arg.revert();
    }
  }

  async function onEventResize(arg: EventResizeDoneArg) {
    const ev = eventById.get(arg.event.id);
    if (!ev?.etag) {
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
    createEvent.isPending ||
    updateEvent.isPending ||
    deleteEvent.isPending;

  return (
    <div className="space-y-4">
      <PageHeader title={t("calendar.title")} description={t("calendar.description")} />

      {!connected ? (
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
              <div className="flex items-center gap-2 pr-2">
                <Switch id="gcal-orders" checked={showOrders} onCheckedChange={setShowOrders} />
                <Label htmlFor="gcal-orders">{t("calendar.showOrders")}</Label>
              </div>
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

          <div className="bg-card gcal-fullcalendar overflow-hidden rounded-lg border p-2 sm:p-3">
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
              selectable
              editable
              eventStartEditable
              eventDurationEditable
              selectMirror
              height="auto"
              events={fcEvents}
              datesSet={onDatesSet}
              select={onSelect}
              eventClick={onEventClick}
              eventDrop={(arg) => void onEventDrop(arg)}
              eventResize={(arg) => void onEventResize(arg)}
              eventAllow={(_span, moving) => moving?.extendedProps?.kind !== "order"}
            />
          </div>
        </>
      )}

      <CalendarEventDialog
        open={dialogOpen}
        draft={draft}
        busy={busy}
        onOpenChange={setDialogOpen}
        onSave={(input) => {
          if (draft?.mode === "edit" && draft.event) {
            if (!input.etag) return;
            updateEvent.mutate(
              { eventId: draft.event.id, input: { ...input, etag: input.etag } },
              {
                onSuccess: () => {
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
          draft?.mode === "edit" && draft.event
            ? () => {
                deleteEvent.mutate(draft.event!.id, { onSuccess: () => setDialogOpen(false) });
              }
            : undefined
        }
      />
    </div>
  );
}
