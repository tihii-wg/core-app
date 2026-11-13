import i18n from "../i18n";
import {
  composeFullCalendarEventId,
  contrastingTextColor,
  isWritableAccessRole,
} from "../features/calendar/gcalColors";
import supabase from "./supabase";

export type GoogleVisibleCalendar = {
  id: string;
  summary: string;
  backgroundColor: string | null;
  foregroundColor: string | null;
  accessRole: string;
};

export type GoogleMainCalendar = {
  id: string;
  summary: string;
  backgroundColor: string | null;
};

export type GoogleCalendarConnection = {
  connected: boolean;
  googleEmail: string | null;
  calendarId: string | null;
  calendarSummary: string | null;
  calendarTimeZone: string | null;
  connectedAt: string | null;
  lastError: string | null;
  reconnectRequired: boolean;
  teamAccess: boolean;
  syncOrders: boolean;
  syncMeasurement: boolean;
  syncInstallation: boolean;
  /** Owner or team_access — non-owners use this to hide the calendar. */
  canAccess: boolean;
  pendingSyncCount?: number;
  lastSyncError?: string | null;
  visibleCalendars: GoogleVisibleCalendar[];
  mainCalendar: GoogleMainCalendar | null;
};

export type GoogleCalendarListItem = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone: string | null;
  backgroundColor: string | null;
  foregroundColor: string | null;
  selected: boolean;
};

export type GoogleCalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start: string;
  end: string;
  allDay: boolean;
  colorId: string | null;
  htmlLink: string | null;
  recurringEventId: string | null;
  updated: string | null;
  etag: string | null;
  authorUserId: string | null;
  authorUserName: string | null;
  coreAppOrderId: string | null;
  coreAppField: string | null;
  calendarId: string | null;
  calendarColor: string | null;
  readOnly: boolean;
  busyOnly: boolean;
};

export type GoogleCalendarErrorEntry = {
  calendarId: string;
  code: string;
};

export type GoogleCalendarApiError = Error & { code?: string };

function requireWorkspaceId(workspaceId: string | undefined): string {
  const id = (workspaceId ?? "").trim();
  if (!id) throw new Error(i18n.t("calendar.errors.noWorkspace"));
  return id;
}

async function sessionAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw Object.assign(new Error(i18n.t("calendar.errors.unauthorized")), { code: "unauthorized" });
  }
  return data.session.access_token;
}

function functionsBaseUrl(): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
  if (!base) throw new Error(i18n.t("calendar.errors.unavailable"));
  return `${base}/functions/v1`;
}

type FunctionErrorBody = {
  url?: string;
  ok?: boolean;
  event?: GoogleCalendarEvent;
  events?: GoogleCalendarEvent[];
  calendarErrors?: GoogleCalendarErrorEntry[];
  calendars?: GoogleCalendarListItem[];
  visibleCalendars?: GoogleVisibleCalendar[];
  mainCalendar?: GoogleMainCalendar | null;
  connected?: boolean;
  googleEmail?: string | null;
  calendarId?: string | null;
  calendarSummary?: string | null;
  calendarTimeZone?: string | null;
  connectedAt?: string | null;
  lastError?: string | null;
  reconnectRequired?: boolean;
  teamAccess?: boolean;
  syncOrders?: boolean;
  syncMeasurement?: boolean;
  syncInstallation?: boolean;
  canAccess?: boolean;
  pendingSyncCount?: number;
  lastSyncError?: string | null;
  error?: { code?: string; message?: string };
};

const emptyConnection = (): GoogleCalendarConnection => ({
  connected: false,
  googleEmail: null,
  calendarId: null,
  calendarSummary: null,
  calendarTimeZone: null,
  connectedAt: null,
  lastError: null,
  reconnectRequired: false,
  teamAccess: false,
  syncOrders: false,
  syncMeasurement: false,
  syncInstallation: false,
  canAccess: false,
  visibleCalendars: [],
  mainCalendar: null,
});

function parseVisible(raw: unknown): GoogleVisibleCalendar[] {
  if (!Array.isArray(raw)) return [];
  const out: GoogleVisibleCalendar[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) continue;
    out.push({
      id,
      summary: typeof row.summary === "string" && row.summary.trim() ? row.summary.trim() : id,
      backgroundColor: typeof row.backgroundColor === "string" ? row.backgroundColor : null,
      foregroundColor: typeof row.foregroundColor === "string" ? row.foregroundColor : null,
      accessRole: typeof row.accessRole === "string" ? row.accessRole : "reader",
    });
  }
  return out;
}

function normalizeEvent(raw: GoogleCalendarEvent): GoogleCalendarEvent {
  return {
    ...raw,
    calendarId: raw.calendarId ?? null,
    calendarColor: raw.calendarColor ?? null,
    readOnly: Boolean(raw.readOnly) || Boolean(raw.busyOnly),
    busyOnly: Boolean(raw.busyOnly),
  };
}

async function readJson(res: Response): Promise<FunctionErrorBody> {
  try {
    return (await res.json()) as FunctionErrorBody;
  } catch {
    return {};
  }
}

function mapError(json: FunctionErrorBody, fallback: string): GoogleCalendarApiError {
  const code = json.error?.code;
  const message = json.error?.message || fallback;
  return Object.assign(new Error(message), { code });
}

async function calendarFetch(
  path: string,
  init?: RequestInit & { workspaceId: string },
): Promise<{ res: Response; json: FunctionErrorBody }> {
  const token = await sessionAccessToken();
  const url = new URL(`${functionsBaseUrl()}${path}`);
  if (!url.searchParams.has("workspaceId")) {
    url.searchParams.set("workspaceId", init!.workspaceId);
  }
  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const json = await readJson(res);
  return { res, json };
}

/** Prefer Edge /status (includes canAccess + sync health); fall back to table select. */
export async function getGoogleCalendarStatus(workspaceId: string | undefined): Promise<GoogleCalendarConnection> {
  const id = requireWorkspaceId(workspaceId);
  try {
    const { res, json } = await calendarFetch("/google-calendar/status", { workspaceId: id });
    if (res.ok) {
      return {
        connected: Boolean(json.connected),
        googleEmail: json.googleEmail ?? null,
        calendarId: json.calendarId ?? null,
        calendarSummary: json.calendarSummary ?? null,
        calendarTimeZone: json.calendarTimeZone ?? null,
        connectedAt: json.connectedAt ?? null,
        lastError: json.lastError ?? null,
        reconnectRequired: Boolean(json.reconnectRequired),
        teamAccess: Boolean(json.teamAccess),
        syncOrders: Boolean(json.syncOrders),
        syncMeasurement: Boolean(json.syncMeasurement),
        syncInstallation: Boolean(json.syncInstallation),
        canAccess: Boolean(json.canAccess),
        pendingSyncCount: typeof json.pendingSyncCount === "number" ? json.pendingSyncCount : undefined,
        lastSyncError: json.lastSyncError ?? null,
        visibleCalendars: parseVisible(json.visibleCalendars),
        mainCalendar: json.mainCalendar
          ? {
              id: json.mainCalendar.id,
              summary: json.mainCalendar.summary,
              backgroundColor: json.mainCalendar.backgroundColor ?? null,
            }
          : json.calendarId
            ? {
                id: json.calendarId,
                summary: json.calendarSummary ?? json.calendarId,
                backgroundColor: null,
              }
            : null,
      };
    }
  } catch {
    // fall through to table
  }

  const { data, error } = await supabase
    .from("workspace_google_calendar")
    .select(
      "google_email, calendar_id, calendar_summary, calendar_time_zone, connected_at, last_error, team_access, sync_orders, sync_measurement, sync_installation, last_sync_error, visible_calendars",
    )
    .eq("workspace_id", id)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || /does not exist|schema cache|column/i.test(error.message ?? "")) {
      return emptyConnection();
    }
    throw new Error(error.message || i18n.t("calendar.errors.loadFailed"));
  }

  const connected = Boolean(data?.calendar_id);
  const lastError = typeof data?.last_error === "string" ? data.last_error : null;
  const teamAccess = data?.team_access === true;
  const visibleCalendars = parseVisible((data as { visible_calendars?: unknown } | null)?.visible_calendars);
  return {
    connected,
    googleEmail: typeof data?.google_email === "string" ? data.google_email : null,
    calendarId: typeof data?.calendar_id === "string" ? data.calendar_id : null,
    calendarSummary: typeof data?.calendar_summary === "string" ? data.calendar_summary : null,
    calendarTimeZone: typeof data?.calendar_time_zone === "string" ? data.calendar_time_zone : null,
    connectedAt: typeof data?.connected_at === "string" ? data.connected_at : null,
    lastError,
    reconnectRequired: Boolean(lastError && !data?.calendar_id),
    teamAccess,
    syncOrders: data?.sync_orders === true,
    syncMeasurement: data?.sync_measurement === true,
    syncInstallation: data?.sync_installation === true,
    canAccess: connected ? teamAccess : true,
    lastSyncError: typeof data?.last_sync_error === "string" ? data.last_sync_error : null,
    visibleCalendars,
    mainCalendar: data?.calendar_id
      ? {
          id: data.calendar_id,
          summary: (typeof data.calendar_summary === "string" && data.calendar_summary) || data.calendar_id,
          backgroundColor: null,
        }
      : null,
  };
}

export async function updateGoogleCalendarSettings(
  workspaceId: string | undefined,
  input: {
    teamAccess?: boolean;
    syncOrders?: boolean;
    syncMeasurement?: boolean;
    syncInstallation?: boolean;
  },
): Promise<void> {
  const id = requireWorkspaceId(workspaceId);
  const { res, json } = await calendarFetch("/google-calendar/settings", {
    method: "POST",
    workspaceId: id,
    body: JSON.stringify(input),
  });
  if (!res.ok) throw mapError(json, i18n.t("calendar.errors.saveFailed"));
}

/** Fire-and-forget client poke to drain the sync queue for this workspace. */
export async function pokeGoogleCalendarSync(workspaceId: string | undefined): Promise<void> {
  const id = requireWorkspaceId(workspaceId);
  const token = await sessionAccessToken();
  await fetch(`${functionsBaseUrl()}/google-calendar-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspaceId: id }),
  });
}

export async function startGoogleCalendarOAuth(workspaceId: string | undefined, locale: string): Promise<string> {
  const id = requireWorkspaceId(workspaceId);
  const token = await sessionAccessToken();
  const res = await fetch(
    `${functionsBaseUrl()}/google-calendar-oauth/start?workspaceId=${encodeURIComponent(id)}&locale=${encodeURIComponent(locale)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "",
      },
    },
  );
  const json = await readJson(res);
  if (!res.ok || !json.url) {
    throw mapError(json, i18n.t("calendar.errors.connectFailed"));
  }
  return json.url;
}

export async function disconnectGoogleCalendar(workspaceId: string | undefined): Promise<void> {
  const id = requireWorkspaceId(workspaceId);
  const { res, json } = await calendarFetch("/google-calendar-oauth/disconnect", {
    method: "POST",
    workspaceId: id,
    body: JSON.stringify({ workspaceId: id }),
  });
  if (!res.ok) throw mapError(json, i18n.t("calendar.errors.disconnectFailed"));
}

export async function listGoogleCalendars(workspaceId: string | undefined): Promise<GoogleCalendarListItem[]> {
  const id = requireWorkspaceId(workspaceId);
  const { res, json } = await calendarFetch("/google-calendar/calendars", { workspaceId: id });
  if (!res.ok) {
    const code = json.error?.code;
    if (code === "not_connected" || code === "reconnect_required") return [];
    throw mapError(json, i18n.t("calendar.errors.loadFailed"));
  }
  return (json.calendars ?? []).map((c) => ({
    ...c,
    backgroundColor: c.backgroundColor ?? null,
    foregroundColor: c.foregroundColor ?? null,
    selected: Boolean(c.selected),
  }));
}

export async function selectGoogleCalendar(workspaceId: string | undefined, calendarId: string): Promise<void> {
  const id = requireWorkspaceId(workspaceId);
  const { res, json } = await calendarFetch("/google-calendar/select-calendar", {
    method: "POST",
    workspaceId: id,
    body: JSON.stringify({ calendarId }),
  });
  if (!res.ok) throw mapError(json, i18n.t("calendar.errors.selectFailed"));
}

export async function setVisibleGoogleCalendars(
  workspaceId: string | undefined,
  calendarIds: string[],
): Promise<GoogleVisibleCalendar[]> {
  const id = requireWorkspaceId(workspaceId);
  const { res, json } = await calendarFetch("/google-calendar/visible-calendars", {
    method: "POST",
    workspaceId: id,
    body: JSON.stringify({ calendarIds }),
  });
  if (!res.ok) throw mapError(json, i18n.t("calendar.errors.visibleFailed"));
  return parseVisible(json.visibleCalendars);
}

export async function listGoogleCalendarEvents(
  workspaceId: string | undefined,
  from: string,
  to: string,
): Promise<{ events: GoogleCalendarEvent[]; calendarErrors: GoogleCalendarErrorEntry[] }> {
  const id = requireWorkspaceId(workspaceId);
  const { res, json } = await calendarFetch(
    `/google-calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { workspaceId: id },
  );
  // Optimistic parallel fetch with status may hit 409 before connect UI settles — no toast.
  if (!res.ok) {
    const code = json.error?.code;
    if (code === "not_connected" || code === "reconnect_required") {
      return { events: [], calendarErrors: [] };
    }
    throw mapError(json, i18n.t("calendar.errors.loadFailed"));
  }
  return {
    events: (json.events ?? []).map(normalizeEvent),
    calendarErrors: Array.isArray(json.calendarErrors) ? json.calendarErrors : [],
  };
}

export type UpsertGoogleCalendarEventInput = {
  title: string;
  description?: string | null;
  location?: string | null;
  start: string;
  end: string;
  allDay: boolean;
  timeZone?: string | null;
  etag?: string;
  calendarId?: string | null;
};

export async function createGoogleCalendarEvent(
  workspaceId: string | undefined,
  input: UpsertGoogleCalendarEventInput,
): Promise<GoogleCalendarEvent> {
  const id = requireWorkspaceId(workspaceId);
  const { res, json } = await calendarFetch("/google-calendar/events", {
    method: "POST",
    workspaceId: id,
    body: JSON.stringify(input),
  });
  if (!res.ok || !json.event) throw mapError(json, i18n.t("calendar.errors.saveFailed"));
  return normalizeEvent(json.event);
}

export async function updateGoogleCalendarEvent(
  workspaceId: string | undefined,
  eventId: string,
  input: UpsertGoogleCalendarEventInput & { etag: string; calendarId: string },
): Promise<GoogleCalendarEvent> {
  const id = requireWorkspaceId(workspaceId);
  const { res, json } = await calendarFetch(`/google-calendar/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    workspaceId: id,
    body: JSON.stringify(input),
  });
  if (!res.ok || !json.event) throw mapError(json, i18n.t("calendar.errors.saveFailed"));
  return normalizeEvent(json.event);
}

export async function deleteGoogleCalendarEvent(
  workspaceId: string | undefined,
  eventId: string,
  calendarId: string,
): Promise<void> {
  const id = requireWorkspaceId(workspaceId);
  const { res, json } = await calendarFetch(
    `/google-calendar/events/${encodeURIComponent(eventId)}?calendarId=${encodeURIComponent(calendarId)}`,
    {
      method: "DELETE",
      workspaceId: id,
      body: JSON.stringify({ calendarId }),
    },
  );
  if (!res.ok) throw mapError(json, i18n.t("calendar.errors.deleteFailed"));
}

export async function moveGoogleCalendarEvent(
  workspaceId: string | undefined,
  eventId: string,
  fromCalendarId: string,
  toCalendarId: string,
): Promise<GoogleCalendarEvent> {
  const id = requireWorkspaceId(workspaceId);
  const { res, json } = await calendarFetch(`/google-calendar/events/${encodeURIComponent(eventId)}/move`, {
    method: "POST",
    workspaceId: id,
    body: JSON.stringify({ fromCalendarId, toCalendarId }),
  });
  if (!res.ok || !json.event) throw mapError(json, i18n.t("calendar.errors.moveFailed"));
  return normalizeEvent(json.event);
}

/** Pure helpers — used by unit tests and FullCalendar adapters. */
export function googleEventToFullCalendar(event: GoogleCalendarEvent, busyTitle = "Busy") {
  const isOrderSync = Boolean(event.coreAppOrderId);
  const readOnly = Boolean(event.readOnly) || Boolean(event.busyOnly) || isOrderSync;
  const calendarId = event.calendarId?.trim() || "";
  const fcId = calendarId ? composeFullCalendarEventId(calendarId, event.id) : event.id;
  const bg = event.calendarColor?.trim() || undefined;
  const text = bg ? contrastingTextColor(bg) : undefined;
  return {
    id: fcId,
    title: event.busyOnly ? busyTitle : event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    editable: !readOnly,
    startEditable: !readOnly,
    durationEditable: !readOnly,
    ...(bg
      ? {
          backgroundColor: bg,
          borderColor: bg,
          textColor: text,
        }
      : isOrderSync
        ? {
            backgroundColor: "var(--color-info)",
            borderColor: "var(--color-info)",
            textColor: "var(--color-info-foreground, #fff)",
          }
        : {}),
    extendedProps: {
      kind: isOrderSync ? ("order_sync" as const) : ("gcal" as const),
      googleEventId: event.id,
      calendarId: event.calendarId,
      calendarColor: event.calendarColor,
      readOnly: Boolean(event.readOnly) || Boolean(event.busyOnly),
      busyOnly: Boolean(event.busyOnly),
      description: event.description,
      location: event.location,
      htmlLink: event.htmlLink,
      recurringEventId: event.recurringEventId,
      etag: event.etag,
      authorUserName: event.authorUserName,
      colorId: event.colorId,
      coreAppOrderId: event.coreAppOrderId,
      coreAppField: event.coreAppField,
      orderId: event.coreAppOrderId,
    },
  };
}

export function isAllDayGoogleRange(start: string, end: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end);
}

export { isWritableAccessRole, composeFullCalendarEventId };
