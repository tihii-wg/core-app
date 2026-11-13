import { corsHeaders, corsOriginFor, errorResponse, jsonResponse } from "../_shared/cors.ts";
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
} from "../_shared/googleCalendar.ts";
import { bearerToken, requireEnv, serviceClient, userClient } from "../_shared/supabase.ts";

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

  const eventMatch = path.match(/\/events\/([^/]+)$/);
  if (eventMatch) {
    const eventId = decodeURIComponent(eventMatch[1]!);
    if (req.method === "PATCH") {
      const body = (await req.json()) as Record<string, unknown>;
      return await patchEvent(admin, workspaceId, eventId, body, clientId, clientSecret, appUrl);
    }
    if (req.method === "DELETE") {
      return await deleteEvent(admin, workspaceId, eventId, clientId, clientSecret, appUrl);
    }
  }

  // Status (connection metadata for UI)
  if (path.endsWith("/status") && req.method === "GET") {
    return await connectionStatus(admin, workspaceId, isOwner, appUrl);
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
  appUrl: string,
) {
  const { data, error } = await admin
    .from("workspace_google_calendar")
    .select(
      "google_email, calendar_id, calendar_summary, calendar_time_zone, connected_at, last_error, updated_at, team_access, sync_orders, sync_measurement, sync_installation, last_sync_error",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) return errorResponse("provider_error", error.message, 500, appUrl);
  const connected = Boolean(data?.calendar_id);
  const teamAccess = data?.team_access === true;
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
  };
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
    // Measurement / installation switched while sync is on: add new events and remove ones no longer wanted.
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
): Promise<{ accessToken: string; calendarId: string; timeZone: string | null } | Response> {
  const { data: row, error } = await admin
    .from("workspace_google_calendar")
    .select("calendar_id, calendar_time_zone, last_error")
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
  };
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

  const res = await googleCalendarFetch(
    token.accessToken,
    "/users/me/calendarList?fields=items(id,summary,primary,accessRole,timeZone)&maxResults=250",
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
    }>;
  };
  const calendars: GCalCalendarListItem[] = (json.items ?? [])
    .filter((item) => item.id)
    .map((item) => ({
      id: item.id!,
      summary: item.summary?.trim() || item.id!,
      primary: Boolean(item.primary),
      accessRole: item.accessRole ?? "reader",
      timeZone: item.timeZone?.trim() || null,
    }));
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
    `/users/me/calendarList/${encodeURIComponent(id)}?fields=id,summary,accessRole,timeZone`,
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
  };
  const role = (cal.accessRole ?? "").toLowerCase();
  if (role !== "owner" && role !== "writer") {
    return errorResponse("forbidden", "Selected calendar requires writer or owner access", 403, appUrl);
  }

  await admin.from("workspace_google_calendar").upsert(
    {
      workspace_id: workspaceId,
      calendar_id: cal.id || id,
      calendar_summary: cal.summary?.trim() || id,
      calendar_time_zone: cal.timeZone?.trim() || null,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
  invalidateEventsCache(workspaceId);

  return jsonResponse(
    {
      ok: true,
      calendarId: cal.id || id,
      calendarSummary: cal.summary?.trim() || id,
      calendarTimeZone: cal.timeZone?.trim() || null,
    },
    200,
    appUrl,
  );
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

  const cacheKey = `${workspaceId}:${access.calendarId}:${from}:${to}`;
  const cached = getCachedEvents(cacheKey);
  if (cached) return jsonResponse(cached, 200, appUrl);

  const events: ReturnType<typeof mapGoogleCalendarEvent>[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      timeMin: from,
      timeMax: to,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      fields:
        "nextPageToken,items(id,summary,description,location,start,end,colorId,htmlLink,recurringEventId,updated,etag,extendedProperties)",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await googleCalendarFetch(
      access.accessToken,
      `/calendars/${encodeURIComponent(access.calendarId)}/events?${params}`,
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
    const json = JSON.parse(text) as { items?: unknown[]; nextPageToken?: string };
    for (const raw of json.items ?? []) {
      const mapped = mapGoogleCalendarEvent(raw as Parameters<typeof mapGoogleCalendarEvent>[0]);
      if (mapped) events.push(mapped);
    }
    pageToken = json.nextPageToken;
  } while (pageToken);

  const payload = { events };
  setCachedEvents(cacheKey, payload);
  return jsonResponse(payload, 200, appUrl);
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

  const access = await withAccess(admin, workspaceId, clientId, clientSecret, appUrl);
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
    `/calendars/${encodeURIComponent(access.calendarId)}/events`,
    { method: "POST", body: JSON.stringify(googleBody) },
  );
  const text = await res.text();
  if (!res.ok) {
    const mapped = mapGoogleCalendarHttpError(res.status, text);
    return errorResponse(mapped.code, mapped.message, mapped.status, appUrl);
  }
  invalidateEventsCache(workspaceId);
  const created = mapGoogleCalendarEvent(JSON.parse(text));
  return jsonResponse({ event: created }, 201, appUrl);
}

async function patchEvent(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  eventId: string,
  body: Record<string, unknown>,
  clientId: string,
  clientSecret: string,
  appUrl: string,
) {
  const etag = typeof body.etag === "string" ? body.etag.trim() : "";
  if (!etag) return errorResponse("invalid_args", "etag required", 400, appUrl);

  const access = await withAccess(admin, workspaceId, clientId, clientSecret, appUrl);
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
    // PATCH merges nested objects: clear the other start/end form when switching all-day ↔ timed.
    patch.start = allDay ? { ...(built.start as object), dateTime: null, timeZone: null } : { ...(built.start as object), date: null };
    patch.end = allDay ? { ...(built.end as object), dateTime: null, timeZone: null } : { ...(built.end as object), date: null };
    if (typeof body.title === "string") patch.summary = built.summary;
  }

  const res = await googleCalendarFetch(
    access.accessToken,
    `/calendars/${encodeURIComponent(access.calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body: JSON.stringify(patch), etag },
  );
  const text = await res.text();
  if (!res.ok) {
    const mapped = mapGoogleCalendarHttpError(res.status, text);
    return errorResponse(mapped.code, mapped.message, mapped.status, appUrl);
  }
  invalidateEventsCache(workspaceId);
  const updated = mapGoogleCalendarEvent(JSON.parse(text));
  return jsonResponse({ event: updated }, 200, appUrl);
}

async function deleteEvent(
  admin: ReturnType<typeof serviceClient>,
  workspaceId: string,
  eventId: string,
  clientId: string,
  clientSecret: string,
  appUrl: string,
) {
  const access = await withAccess(admin, workspaceId, clientId, clientSecret, appUrl);
  if (access instanceof Response) return access;

  const res = await googleCalendarFetch(
    access.accessToken,
    `/calendars/${encodeURIComponent(access.calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
  // 404 / 410: already deleted in Google — treat as success so the UI just refreshes.
  if (res.status !== 204 && !res.ok && res.status !== 404 && res.status !== 410) {
    const text = await res.text();
    const mapped = mapGoogleCalendarHttpError(res.status, text);
    return errorResponse(mapped.code, mapped.message, mapped.status, appUrl);
  }
  invalidateEventsCache(workspaceId);
  return jsonResponse({ ok: true }, 200, appUrl);
}
