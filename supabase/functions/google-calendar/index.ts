import { corsHeaders, corsOriginFor, errorResponse, jsonResponse } from "../_shared/cors.ts";
import {
  isBusyOnlyAccessRole,
  isWritableAccessRole,
  normalizeVisibleList,
  parseVisibleCalendars,
  type VisibleCalendarSnapshot,
} from "../_shared/gcalMulti.ts";
import {
  buildGoogleEventBody,
  getCachedEvents,
  googleCalendarFetch,
  invalidateEventsCache,
  mapGoogleCalendarEvent,
  mapGoogleCalendarHttpError,
  setCachedEvents,
  workspaceCalendarAccessToken,
  type GCalCalendarListItem,
  type GCalEventDto,
} from "../_shared/googleCalendar.ts";
import { bearerToken, requireEnv, serviceClient, userClient } from "../_shared/supabase.ts";

/** Per-isolate cache for main calendar list metadata (colors). */
const mainCalendarMetaCache = new Map<string, { id: string; summary: string; backgroundColor: string | null; at: number }>();
const MAIN_META_TTL_MS = 10 * 60_000;

Deno.serve(async (req) => {
  const appUrl = corsOriginFor((Deno.env.get("APP_URL") ?? "").replace(/\/$/, ""), req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(appUrl) });
  }

  try {
    return await route(req, appUrl);
  } catch (error) {
    console.error("[google-calendar]", error instanceof Error ? error.message : error);
    return errorResponse("provider_error", error instanceof Error ? error.message : "Calendar API failed", 500, appUrl);
  }
});

async function route(req: Request, appUrl: string): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const workspaceId =
    url.searchParams.get("workspaceId")?.trim() ||
    (req.headers.get("x-workspace-id") ?? "").trim();

  const auth = await requireMember(req, workspaceId, appUrl);
  if (auth instanceof Response) return auth;
  const { user, jwtUserId, displayName, isOwner } = auth;

  const admin = serviceClient();
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");

  // Owner: GET calendars
  if (path.endsWith("/calendars") && req.method === "GET") {
    if (!isOwner) {
      return errorResponse("owner_only", "Only the workspace owner can manage the shared calendar connection", 403, appUrl);
    }
    return await listCalendars(admin, workspaceId, clientId, clientSecret, appUrl);
  }

  // Owner: POST select-calendar
  if (path.endsWith("/select-calendar") && req.method === "POST") {
    if (!isOwner) {
      return errorResponse("owner_only", "Only the workspace owner can manage the shared calendar connection", 403, appUrl);
    }
    const body = (await req.json()) as { calendarId?: string };
    return await selectCalendar(admin, workspaceId, body.calendarId ?? "", clientId, clientSecret, appUrl);
  }

  // Owner: POST visible-calendars
  if (path.endsWith("/visible-calendars") && req.method === "POST") {
    if (!isOwner) {
      return errorResponse("owner_only", "Only the workspace owner can manage the shared calendar connection", 403, appUrl);
    }
    const body = (await req.json()) as { calendarIds?: string[] };
    return await setVisibleCalendars(admin, workspaceId, body.calendarIds ?? [], clientId, clientSecret, appUrl);
  }

  // Owner: POST settings (team access + sync toggles)
  if (path.endsWith("/settings") && req.method === "POST") {
    if (!isOwner) {
      return errorResponse("owner_only", "Only the workspace owner can change calendar settings", 403, appUrl);
    }
    const body = (await req.json()) as {
      teamAccess?: boolean;
      syncOrders?: boolean;
      syncMeasurement?: boolean;
      syncInstallation?: boolean;
    };
    return await updateSettings(admin, workspaceId, body, appUrl);
  }

  // Members: events CRUD (gated by team_access for non-owners)
  if (path.includes("/events")) {
    const accessGate = await requireTeamCalendarAccess(admin, workspaceId, isOwner, appUrl);
    if (accessGate) return accessGate;
  }

  if (path.endsWith("/events") && req.method === "GET") {
    const from = url.searchParams.get("from")?.trim() ?? "";
    const to = url.searchParams.get("to")?.trim() ?? "";
    return await listEvents(admin, workspaceId, from, to, clientId, clientSecret, appUrl);
  }

  if (path.endsWith("/events") && req.method === "POST") {
    const body = (await req.json()) as Record<string, unknown>;
    return await createEvent(admin, workspaceId, body, jwtUserId, displayName, clientId, clientSecret, appUrl);
  }

  const moveMatch = path.match(/\/events\/([^/]+)\/move$/);
  if (moveMatch && req.method === "POST") {
    const eventId = decodeURIComponent(moveMatch[1]!);
    const body = (await req.json()) as { fromCalendarId?: string; toCalendarId?: string };
    return await moveEvent(
      admin,
      workspaceId,
      eventId,
      body.fromCalendarId ?? "",
      body.toCalendarId ?? "",
      clientId,
      clientSecret,
      appUrl,
    );
  }

  const eventMatch = path.match(/\/events\/([^/]+)$/);
  if (eventMatch) {
    const eventId = decodeURIComponent(eventMatch[1]!);
    if (req.method === "PATCH") {
      const body = (await req.json()) as Record<string, unknown>;
      const calendarId =
        (typeof body.calendarId === "string" && body.calendarId.trim()) ||
        url.searchParams.get("calendarId")?.trim() ||
        "";
      return await patchEvent(admin, workspaceId, eventId, calendarId, body, clientId, clientSecret, appUrl);
    }
    if (req.method === "DELETE") {
      let calendarId = url.searchParams.get("calendarId")?.trim() || "";
      if (!calendarId) {
        try {
          const body = (await req.json()) as { calendarId?: string };
          calendarId = body.calendarId?.trim() || "";
        } catch {
          // no body
        }
      }
      return await deleteEvent(admin, workspaceId, eventId, calendarId, clientId, clientSecret, appUrl);
    }
  }

  // Status (connection metadata for UI)
  if (path.endsWith("/status") && req.method === "GET") {
    return await connectionStatus(admin, workspaceId, isOwner, clientId, clientSecret, appUrl);
  }

  return errorResponse("not_found", "Unknown route", 404, appUrl);
}

async function requireMember(
  req: Request,
  workspaceId: string,
  appUrl: string,
): Promise<
  Response | { user: ReturnType<typeof userClient>; jwtUserId: string; displayName: string; isOwner: boolean }
> {
  if (!workspaceId) return errorResponse("invalid_args", "workspaceId required", 400, appUrl);
  const jwt = bearerToken(req);
  if (!jwt) return errorResponse("unauthorized", "Missing bearer token", 401, appUrl);

  const user = userClient(jwt);
  const { data: userData, error: userError } = await user.auth.getUser(jwt);
  if (userError || !userData.user) return errorResponse("unauthorized", "Invalid session", 401, appUrl);

  const { data: isMember } = await user.rpc("is_workspace_member", { target_workspace_id: workspaceId });
  if (isMember !== true) {
    return errorResponse("forbidden", "Not a workspace member", 403, appUrl);
  }

  const { data: isOwnerRaw } = await user.rpc("crm_is_workspace_owner_id", { p_workspace_id: workspaceId });
  const isOwner = isOwnerRaw === true;

  const meta = userData.user.user_metadata as Record<string, unknown> | undefined;
  const displayName =
    (typeof meta?.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta?.name === "string" && meta.name.trim()) ||
    userData.user.email?.split("@")[0] ||
    "User";

  return { user, jwtUserId: userData.user.id, displayName, isOwner };
}

async function requireTeamCalendarAccess(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  isOwner: boolean,
  appUrl: string,
): Promise<Response | null> {
  if (isOwner) return null;
  const { data } = await admin
    .from("workspace_google_calendar")
    .select("team_access, calendar_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data?.calendar_id) {
    return errorResponse("not_connected", "Google Calendar is not connected", 409, appUrl);
  }
  if (data.team_access !== true) {
    return errorResponse("owner_only_calendar", "Calendar is available to the owner only", 403, appUrl);
  }
  return null;
}

async function connectionStatus(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  isOwner: boolean,
  clientId: string,
  clientSecret: string,
  appUrl: string,
) {
  const { data, error } = await admin
    .from("workspace_google_calendar")
    .select(
      "google_email, calendar_id, calendar_summary, calendar_time_zone, connected_at, last_error, updated_at, team_access, sync_orders, sync_measurement, sync_installation, last_sync_error, visible_calendars",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) return errorResponse("provider_error", error.message, 500, appUrl);
  const connected = Boolean(data?.calendar_id);
  const teamAccess = data?.team_access === true;
  const visibleCalendars = parseVisibleCalendars(data?.visible_calendars);
  const payload: Record<string, unknown> = {
    connected,
    googleEmail: data?.google_email ?? null,
    calendarId: data?.calendar_id ?? null,
    calendarSummary: data?.calendar_summary ?? null,
    calendarTimeZone: data?.calendar_time_zone ?? null,
    connectedAt: data?.connected_at ?? null,
    lastError: data?.last_error ?? null,
    reconnectRequired: Boolean(data?.last_error && !data?.calendar_id),
    teamAccess,
    syncOrders: data?.sync_orders === true,
    syncMeasurement: data?.sync_measurement === true,
    syncInstallation: data?.sync_installation === true,
    canAccess: isOwner || teamAccess,
    visibleCalendars,
    mainCalendar: null as null | { id: string; summary: string; backgroundColor: string | null },
  };

  if (connected && data?.calendar_id) {
    payload.mainCalendar = await resolveMainCalendarMeta(
      admin,
      workspaceId,
      data.calendar_id,
      data.calendar_summary ?? data.calendar_id,
      clientId,
      clientSecret,
    );
  }

  if (isOwner) {
    const { count } = await admin
      .from("gcal_sync_queue")
      .select("order_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    payload.pendingSyncCount = count ?? 0;
    payload.lastSyncError = data?.last_sync_error ?? null;
  }
  return jsonResponse(payload, 200, appUrl);
}

async function resolveMainCalendarMeta(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  calendarId: string,
  summary: string,
  clientId: string,
  clientSecret: string,
): Promise<{ id: string; summary: string; backgroundColor: string | null }> {
  const cached = mainCalendarMetaCache.get(workspaceId);
  if (cached && cached.id === calendarId && Date.now() - cached.at < MAIN_META_TTL_MS) {
    return { id: cached.id, summary: cached.summary, backgroundColor: cached.backgroundColor };
  }

  let backgroundColor: string | null = null;
  let resolvedSummary = summary;
  try {
    const token = await workspaceCalendarAccessToken(admin, workspaceId, clientId, clientSecret);
    if (!("error" in token)) {
      const res = await googleCalendarFetch(
        token.accessToken,
        `/users/me/calendarList/${encodeURIComponent(calendarId)}?fields=id,summary,backgroundColor`,
      );
      if (res.ok) {
        const json = (await res.json()) as { summary?: string; backgroundColor?: string };
        if (json.summary?.trim()) resolvedSummary = json.summary.trim();
        if (json.backgroundColor?.trim()) backgroundColor = json.backgroundColor.trim();
      }
    }
  } catch {
    // keep defaults
  }

  const meta = { id: calendarId, summary: resolvedSummary, backgroundColor, at: Date.now() };
  mainCalendarMetaCache.set(workspaceId, meta);
  return { id: meta.id, summary: meta.summary, backgroundColor: meta.backgroundColor };
}

async function updateSettings(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  body: {
    teamAccess?: boolean;
    syncOrders?: boolean;
    syncMeasurement?: boolean;
    syncInstallation?: boolean;
  },
  appUrl: string,
) {
  const { data: current, error: loadError } = await admin
    .from("workspace_google_calendar")
    .select("calendar_id, sync_orders, team_access, sync_measurement, sync_installation")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (loadError) return errorResponse("provider_error", loadError.message, 500, appUrl);
  if (!current?.calendar_id) {
    return errorResponse("not_connected", "Google Calendar is not connected", 409, appUrl);
  }

  const prevSync = current.sync_orders === true;
  const nextSync = typeof body.syncOrders === "boolean" ? body.syncOrders : prevSync;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.teamAccess === "boolean") patch.team_access = body.teamAccess;
  if (typeof body.syncOrders === "boolean") patch.sync_orders = body.syncOrders;
  if (typeof body.syncMeasurement === "boolean") patch.sync_measurement = body.syncMeasurement;
  if (typeof body.syncInstallation === "boolean") patch.sync_installation = body.syncInstallation;

  const { error: updError } = await admin
    .from("workspace_google_calendar")
    .update(patch)
    .eq("workspace_id", workspaceId);
  if (updError) return errorResponse("provider_error", updError.message, 500, appUrl);

  const fieldToggled =
    (typeof body.syncMeasurement === "boolean" && body.syncMeasurement !== (current.sync_measurement === true)) ||
    (typeof body.syncInstallation === "boolean" && body.syncInstallation !== (current.sync_installation === true));

  if (!prevSync && nextSync) {
    await admin.rpc("crm_gcal_enqueue_backfill", { p_workspace_id: workspaceId });
  } else if (prevSync && !nextSync) {
    await admin.rpc("crm_gcal_enqueue_linked_orders", { p_workspace_id: workspaceId });
  } else if (nextSync && fieldToggled) {
    await admin.rpc("crm_gcal_enqueue_backfill", { p_workspace_id: workspaceId });
    await admin.rpc("crm_gcal_enqueue_linked_orders", { p_workspace_id: workspaceId });
  }

  return jsonResponse(
    {
      ok: true,
      teamAccess: typeof body.teamAccess === "boolean" ? body.teamAccess : current.team_access === true,
      syncOrders: nextSync,
      syncMeasurement:
        typeof body.syncMeasurement === "boolean" ? body.syncMeasurement : current.sync_measurement === true,
      syncInstallation:
        typeof body.syncInstallation === "boolean" ? body.syncInstallation : current.sync_installation === true,
    },
    200,
    appUrl,
  );
}

async function withAccess(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  clientId: string,
  clientSecret: string,
  appUrl: string,
): Promise<
  | {
      accessToken: string;
      calendarId: string;
      timeZone: string | null;
      visibleCalendars: VisibleCalendarSnapshot[];
    }
  | Response
> {
  const { data: row, error } = await admin
    .from("workspace_google_calendar")
    .select("calendar_id, calendar_time_zone, last_error, visible_calendars")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) return errorResponse("provider_error", error.message, 500, appUrl);
  if (!row?.calendar_id) {
    return errorResponse("not_connected", "Google Calendar is not connected", 409, appUrl);
  }

  const token = await workspaceCalendarAccessToken(admin, workspaceId, clientId, clientSecret);
  if ("error" in token) {
    return errorResponse(token.error.code, token.error.message, token.error.status, appUrl);
  }
  return {
    accessToken: token.accessToken,
    calendarId: row.calendar_id,
    timeZone: row.calendar_time_zone ?? null,
    visibleCalendars: parseVisibleCalendars(row.visible_calendars),
  };
}

type AllowedCalendar = {
  id: string;
  accessRole: string;
  backgroundColor: string | null;
  summary: string;
  isMain: boolean;
};

function buildAllowedCalendars(
  mainId: string,
  mainSummary: string,
  mainBg: string | null,
  visible: VisibleCalendarSnapshot[],
): AllowedCalendar[] {
  const list: AllowedCalendar[] = [
    {
      id: mainId,
      accessRole: "owner",
      backgroundColor: mainBg,
      summary: mainSummary,
      isMain: true,
    },
  ];
  for (const v of visible) {
    if (v.id === mainId) continue;
    list.push({
      id: v.id,
      accessRole: v.accessRole,
      backgroundColor: v.backgroundColor,
      summary: v.summary,
      isMain: false,
    });
  }
  return list;
}

function findAllowedCalendar(allowed: AllowedCalendar[], calendarId: string): AllowedCalendar | undefined {
  return allowed.find((c) => c.id === calendarId);
}

async function listCalendars(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  clientId: string,
  clientSecret: string,
  appUrl: string,
) {
  const token = await workspaceCalendarAccessToken(admin, workspaceId, clientId, clientSecret);
  if ("error" in token) {
    return errorResponse(token.error.code, token.error.message, token.error.status, appUrl);
  }

  const { data: row } = await admin
    .from("workspace_google_calendar")
    .select("calendar_id, visible_calendars")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const mainId = row?.calendar_id?.trim() || "";
  const visibleIds = new Set(parseVisibleCalendars(row?.visible_calendars).map((v) => v.id));

  const res = await googleCalendarFetch(
    token.accessToken,
    "/users/me/calendarList?fields=items(id,summary,primary,accessRole,timeZone,backgroundColor,foregroundColor)&maxResults=250",
  );
  const text = await res.text();
  if (!res.ok) {
    const mapped = mapGoogleCalendarHttpError(res.status, text);
    if (mapped.code === "reconnect_required") {
      const { clearCalendarCredentialOnAuthFailure } = await import("../_shared/googleCalendar.ts");
      await clearCalendarCredentialOnAuthFailure(admin, workspaceId, mapped.message);
    }
    return errorResponse(mapped.code, mapped.message, mapped.status, appUrl);
  }
  const json = JSON.parse(text) as {
    items?: Array<{
      id?: string;
      summary?: string;
      primary?: boolean;
      accessRole?: string;
      timeZone?: string;
      backgroundColor?: string;
      foregroundColor?: string;
    }>;
  };
  const calendars: GCalCalendarListItem[] = (json.items ?? [])
    .filter((item) => item.id)
    .map((item) => {
      const id = item.id!;
      const isMain = Boolean(mainId && (id === mainId || (mainId === "primary" && item.primary)));
      return {
        id,
        summary: item.summary?.trim() || id,
        primary: Boolean(item.primary),
        accessRole: item.accessRole ?? "reader",
        timeZone: item.timeZone?.trim() || null,
        backgroundColor: item.backgroundColor?.trim() || null,
        foregroundColor: item.foregroundColor?.trim() || null,
        selected: isMain || visibleIds.has(id),
      };
    });
  return jsonResponse({ calendars }, 200, appUrl);
}

async function selectCalendar(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  calendarId: string,
  clientId: string,
  clientSecret: string,
  appUrl: string,
) {
  const id = calendarId.trim();
  if (!id) return errorResponse("invalid_args", "calendarId required", 400, appUrl);

  const token = await workspaceCalendarAccessToken(admin, workspaceId, clientId, clientSecret);
  if ("error" in token) {
    return errorResponse(token.error.code, token.error.message, token.error.status, appUrl);
  }

  const listRes = await googleCalendarFetch(
    token.accessToken,
    `/users/me/calendarList/${encodeURIComponent(id)}?fields=id,summary,accessRole,timeZone,backgroundColor`,
  );
  const listText = await listRes.text();
  if (!listRes.ok) {
    const mapped = mapGoogleCalendarHttpError(listRes.status, listText);
    return errorResponse(mapped.code, mapped.message, mapped.status, appUrl);
  }
  const cal = JSON.parse(listText) as {
    id?: string;
    summary?: string;
    accessRole?: string;
    timeZone?: string;
    backgroundColor?: string;
  };
  const role = (cal.accessRole ?? "").toLowerCase();
  if (role !== "owner" && role !== "writer") {
    return errorResponse("forbidden", "Selected calendar requires writer or owner access", 403, appUrl);
  }

  const newMainId = cal.id || id;
  const { data: current } = await admin
    .from("workspace_google_calendar")
    .select("visible_calendars")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const nextVisible = normalizeVisibleList(parseVisibleCalendars(current?.visible_calendars), newMainId);

  await admin.from("workspace_google_calendar").upsert(
    {
      workspace_id: workspaceId,
      calendar_id: newMainId,
      calendar_summary: cal.summary?.trim() || id,
      calendar_time_zone: cal.timeZone?.trim() || null,
      visible_calendars: nextVisible,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
  mainCalendarMetaCache.delete(workspaceId);
  invalidateEventsCache(workspaceId);

  return jsonResponse(
    {
      ok: true,
      calendarId: newMainId,
      calendarSummary: cal.summary?.trim() || id,
      calendarTimeZone: cal.timeZone?.trim() || null,
      visibleCalendars: nextVisible,
    },
    200,
    appUrl,
  );
}

async function setVisibleCalendars(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  calendarIds: string[],
  clientId: string,
  clientSecret: string,
  appUrl: string,
) {
  const access = await withAccess(admin, workspaceId, clientId, clientSecret, appUrl);
  if (access instanceof Response) return access;

  const mainId = access.calendarId;
  const requested = [...new Set(calendarIds.map((id) => String(id).trim()).filter(Boolean))].filter(
    (id) => id !== mainId,
  );
  if (requested.length > 9) {
    return errorResponse("invalid_args", "At most 9 extra calendars allowed", 400, appUrl);
  }

  const snapshots: VisibleCalendarSnapshot[] = [];
  for (const id of requested) {
    const res = await googleCalendarFetch(
      access.accessToken,
      `/users/me/calendarList/${encodeURIComponent(id)}?fields=id,summary,primary,accessRole,backgroundColor,foregroundColor`,
    );
    const text = await res.text();
    if (!res.ok) {
      const mapped = mapGoogleCalendarHttpError(res.status, text);
      return errorResponse(mapped.code, `Calendar ${id}: ${mapped.message}`, mapped.status, appUrl);
    }
    const cal = JSON.parse(text) as {
      id?: string;
      summary?: string;
      primary?: boolean;
      accessRole?: string;
      backgroundColor?: string;
      foregroundColor?: string;
    };
    if (cal.primary && mainId === "primary") continue; // same calendar as main (legacy alias)
    snapshots.push({
      id: cal.id || id,
      summary: cal.summary?.trim() || id,
      backgroundColor: cal.backgroundColor?.trim() || null,
      foregroundColor: cal.foregroundColor?.trim() || null,
      accessRole: cal.accessRole ?? "reader",
    });
  }

  const normalized = normalizeVisibleList(snapshots, mainId);
  const { error } = await admin
    .from("workspace_google_calendar")
    .update({
      visible_calendars: normalized,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId);
  if (error) return errorResponse("provider_error", error.message, 500, appUrl);

  invalidateEventsCache(workspaceId);
  return jsonResponse({ visibleCalendars: normalized }, 200, appUrl);
}

async function fetchEventsForCalendar(opts: {
  accessToken: string;
  workspaceId: string;
  calendarId: string;
  from: string;
  to: string;
  backgroundColor: string | null;
  accessRole: string;
}): Promise<{ events: GCalEventDto[]; error?: { calendarId: string; code: string } }> {
  const busyOnly = isBusyOnlyAccessRole(opts.accessRole);
  const readOnly = !isWritableAccessRole(opts.accessRole);
  const cacheKey = `${opts.workspaceId}:${opts.calendarId}:${opts.from}:${opts.to}`;
  const cached = getCachedEvents(cacheKey) as { events: GCalEventDto[] } | null;
  if (cached?.events) return { events: cached.events };

  const events: GCalEventDto[] = [];
  let pageToken: string | undefined;
  const fields = busyOnly
    ? "nextPageToken,items(id,start,end,colorId,updated,etag)"
    : "nextPageToken,items(id,summary,description,location,start,end,colorId,htmlLink,recurringEventId,updated,etag,extendedProperties)";

  try {
    do {
      const params = new URLSearchParams({
        timeMin: opts.from,
        timeMax: opts.to,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "2500",
        fields,
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await googleCalendarFetch(
        opts.accessToken,
        `/calendars/${encodeURIComponent(opts.calendarId)}/events?${params}`,
      );
      const text = await res.text();
      if (!res.ok) {
        const mapped = mapGoogleCalendarHttpError(res.status, text);
        const code =
          res.status === 404 || res.status === 403
            ? String(res.status)
            : mapped.code;
        return { events: [], error: { calendarId: opts.calendarId, code } };
      }
      const json = JSON.parse(text) as { items?: unknown[]; nextPageToken?: string };
      for (const raw of json.items ?? []) {
        const mapped = mapGoogleCalendarEvent(raw as Parameters<typeof mapGoogleCalendarEvent>[0], {
          calendarId: opts.calendarId,
          calendarBackground: opts.backgroundColor,
          readOnly,
          busyOnly,
        });
        if (mapped) events.push(mapped);
      }
      pageToken = json.nextPageToken;
    } while (pageToken);
  } catch {
    return { events: [], error: { calendarId: opts.calendarId, code: "provider_error" } };
  }

  setCachedEvents(cacheKey, { events });
  return { events };
}

async function listEvents(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  from: string,
  to: string,
  clientId: string,
  clientSecret: string,
  appUrl: string,
) {
  if (!from || !to) return errorResponse("invalid_args", "from and to required", 400, appUrl);
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs || toMs - fromMs > 400 * 86_400_000) {
    return errorResponse("invalid_args", "from/to must be valid ISO dates within 400 days", 400, appUrl);
  }

  const access = await withAccess(admin, workspaceId, clientId, clientSecret, appUrl);
  if (access instanceof Response) return access;

  const mainMeta = await resolveMainCalendarMeta(
    admin,
    workspaceId,
    access.calendarId,
    access.calendarId,
    clientId,
    clientSecret,
  );

  const targets = buildAllowedCalendars(
    access.calendarId,
    mainMeta.summary,
    mainMeta.backgroundColor,
    access.visibleCalendars,
  );

  const results = await Promise.allSettled(
    targets.map((cal) =>
      fetchEventsForCalendar({
        accessToken: access.accessToken,
        workspaceId,
        calendarId: cal.id,
        from,
        to,
        backgroundColor: cal.backgroundColor,
        accessRole: cal.accessRole,
      }),
    ),
  );

  const events: GCalEventDto[] = [];
  const calendarErrors: Array<{ calendarId: string; code: string }> = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const cal = targets[i]!;
    if (result.status === "rejected") {
      calendarErrors.push({ calendarId: cal.id, code: "provider_error" });
      continue;
    }
    if (result.value.error) {
      calendarErrors.push(result.value.error);
    }
    events.push(...result.value.events);
  }

  return jsonResponse({ events, calendarErrors }, 200, appUrl);
}

type WorkspaceAccess = {
  accessToken: string;
  calendarId: string;
  timeZone: string | null;
  visibleCalendars: VisibleCalendarSnapshot[];
};

async function resolveWritableTarget(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  requestedCalendarId: string | null | undefined,
  clientId: string,
  clientSecret: string,
  appUrl: string,
): Promise<{ access: WorkspaceAccess; target: AllowedCalendar } | Response> {
  const access = await withAccess(admin, workspaceId, clientId, clientSecret, appUrl);
  if (access instanceof Response) return access;

  const mainMeta = await resolveMainCalendarMeta(
    admin,
    workspaceId,
    access.calendarId,
    access.calendarId,
    clientId,
    clientSecret,
  );
  const allowed = buildAllowedCalendars(
    access.calendarId,
    mainMeta.summary,
    mainMeta.backgroundColor,
    access.visibleCalendars,
  );
  const targetId = requestedCalendarId?.trim() || access.calendarId;
  const target = findAllowedCalendar(allowed, targetId);
  if (!target) {
    return errorResponse("forbidden", "Calendar is not in the visible set", 403, appUrl);
  }
  // Main is always treated as writable for the connected account.
  if (!target.isMain && !isWritableAccessRole(target.accessRole)) {
    return errorResponse("calendar_read_only", "Calendar is read-only", 403, appUrl);
  }
  return { access, target };
}

async function createEvent(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  body: Record<string, unknown>,
  userId: string,
  userName: string,
  clientId: string,
  clientSecret: string,
  appUrl: string,
) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const start = typeof body.start === "string" ? body.start : "";
  const end = typeof body.end === "string" ? body.end : "";
  const allDay = Boolean(body.allDay);
  if (!title || !start || !end) {
    return errorResponse("invalid_args", "title, start, and end required", 400, appUrl);
  }

  const resolved = await resolveWritableTarget(
    admin,
    workspaceId,
    typeof body.calendarId === "string" ? body.calendarId : null,
    clientId,
    clientSecret,
    appUrl,
  );
  if (resolved instanceof Response) return resolved;
  const { access, target } = resolved;
  if (access instanceof Response) return access;

  const timeZone =
    (typeof body.timeZone === "string" && body.timeZone.trim()) || access.timeZone || undefined;
  const googleBody = buildGoogleEventBody({
    title,
    description: typeof body.description === "string" ? body.description : null,
    location: typeof body.location === "string" ? body.location : null,
    start,
    end,
    allDay,
    timeZone,
    authorUserId: userId,
    authorUserName: userName,
  });

  const res = await googleCalendarFetch(
    access.accessToken,
    `/calendars/${encodeURIComponent(target.id)}/events`,
    { method: "POST", body: JSON.stringify(googleBody) },
  );
  const text = await res.text();
  if (!res.ok) {
    const mapped = mapGoogleCalendarHttpError(res.status, text);
    return errorResponse(mapped.code, mapped.message, mapped.status, appUrl);
  }
  invalidateEventsCache(workspaceId, target.id);
  const created = mapGoogleCalendarEvent(JSON.parse(text), {
    calendarId: target.id,
    calendarBackground: target.backgroundColor,
    readOnly: false,
    busyOnly: false,
  });
  return jsonResponse({ event: created }, 201, appUrl);
}

async function patchEvent(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  eventId: string,
  calendarId: string,
  body: Record<string, unknown>,
  clientId: string,
  clientSecret: string,
  appUrl: string,
) {
  const etag = typeof body.etag === "string" ? body.etag.trim() : "";
  if (!etag) return errorResponse("invalid_args", "etag required", 400, appUrl);
  if (!calendarId.trim()) return errorResponse("invalid_args", "calendarId required", 400, appUrl);

  const resolved = await resolveWritableTarget(admin, workspaceId, calendarId, clientId, clientSecret, appUrl);
  if (resolved instanceof Response) return resolved;
  const { access, target } = resolved;
  if (access instanceof Response) return access;

  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") patch.summary = body.title.trim();
  if (body.description !== undefined) {
    patch.description = typeof body.description === "string" ? body.description : null;
  }
  if (body.location !== undefined) {
    patch.location = typeof body.location === "string" ? body.location : null;
  }
  if (typeof body.start === "string" && typeof body.end === "string") {
    const allDay = Boolean(body.allDay);
    const timeZone =
      (typeof body.timeZone === "string" && body.timeZone.trim()) || access.timeZone || undefined;
    const built = buildGoogleEventBody({
      title: typeof body.title === "string" ? body.title : "",
      start: body.start,
      end: body.end,
      allDay,
      timeZone,
    });
    patch.start = allDay ? { ...(built.start as object), dateTime: null, timeZone: null } : { ...(built.start as object), date: null };
    patch.end = allDay ? { ...(built.end as object), dateTime: null, timeZone: null } : { ...(built.end as object), date: null };
    if (typeof body.title === "string") patch.summary = built.summary;
  }

  const res = await googleCalendarFetch(
    access.accessToken,
    `/calendars/${encodeURIComponent(target.id)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body: JSON.stringify(patch), etag },
  );
  const text = await res.text();
  if (!res.ok) {
    const mapped = mapGoogleCalendarHttpError(res.status, text);
    return errorResponse(mapped.code, mapped.message, mapped.status, appUrl);
  }
  invalidateEventsCache(workspaceId, target.id);
  const updated = mapGoogleCalendarEvent(JSON.parse(text), {
    calendarId: target.id,
    calendarBackground: target.backgroundColor,
    readOnly: false,
    busyOnly: false,
  });
  return jsonResponse({ event: updated }, 200, appUrl);
}

async function deleteEvent(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  eventId: string,
  calendarId: string,
  clientId: string,
  clientSecret: string,
  appUrl: string,
) {
  if (!calendarId.trim()) return errorResponse("invalid_args", "calendarId required", 400, appUrl);

  const resolved = await resolveWritableTarget(admin, workspaceId, calendarId, clientId, clientSecret, appUrl);
  if (resolved instanceof Response) return resolved;
  const { access, target } = resolved;
  if (access instanceof Response) return access;

  const res = await googleCalendarFetch(
    access.accessToken,
    `/calendars/${encodeURIComponent(target.id)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
  if (res.status !== 204 && !res.ok && res.status !== 404 && res.status !== 410) {
    const text = await res.text();
    const mapped = mapGoogleCalendarHttpError(res.status, text);
    return errorResponse(mapped.code, mapped.message, mapped.status, appUrl);
  }
  invalidateEventsCache(workspaceId, target.id);
  return jsonResponse({ ok: true }, 200, appUrl);
}

async function moveEvent(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  eventId: string,
  fromCalendarId: string,
  toCalendarId: string,
  clientId: string,
  clientSecret: string,
  appUrl: string,
) {
  const fromId = fromCalendarId.trim();
  const toId = toCalendarId.trim();
  if (!fromId || !toId) {
    return errorResponse("invalid_args", "fromCalendarId and toCalendarId required", 400, appUrl);
  }
  if (fromId === toId) {
    return errorResponse("invalid_args", "from and to calendars must differ", 400, appUrl);
  }

  const fromResolved = await resolveWritableTarget(admin, workspaceId, fromId, clientId, clientSecret, appUrl);
  if (fromResolved instanceof Response) return fromResolved;
  const toResolved = await resolveWritableTarget(admin, workspaceId, toId, clientId, clientSecret, appUrl);
  if (toResolved instanceof Response) return toResolved;
  const { access } = fromResolved;
  if (access instanceof Response) return access;

  // Refuse moving order-sync events
  const getRes = await googleCalendarFetch(
    access.accessToken,
    `/calendars/${encodeURIComponent(fromId)}/events/${encodeURIComponent(eventId)}?fields=id,extendedProperties`,
  );
  if (getRes.ok) {
    const existing = (await getRes.json()) as {
      extendedProperties?: { private?: Record<string, string> };
    };
    if (existing.extendedProperties?.private?.core_app_order_id) {
      return errorResponse("order_event_locked", "Order-synced events cannot be moved", 403, appUrl);
    }
  }

  const res = await googleCalendarFetch(
    access.accessToken,
    `/calendars/${encodeURIComponent(fromId)}/events/${encodeURIComponent(eventId)}/move?destination=${encodeURIComponent(toId)}`,
    { method: "POST" },
  );
  const text = await res.text();
  if (!res.ok) {
    const mapped = mapGoogleCalendarHttpError(res.status, text);
    return errorResponse(mapped.code, mapped.message, mapped.status, appUrl);
  }

  invalidateEventsCache(workspaceId, fromId);
  invalidateEventsCache(workspaceId, toId);

  const moved = mapGoogleCalendarEvent(JSON.parse(text), {
    calendarId: toId,
    calendarBackground: toResolved.target.backgroundColor,
    readOnly: false,
    busyOnly: false,
  });
  return jsonResponse({ event: moved }, 200, appUrl);
}
