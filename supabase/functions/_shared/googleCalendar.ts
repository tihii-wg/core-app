import { googleAccessToken, isGoogleAuthError, type GoogleCredential } from "./googleDrive.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type { GoogleCredential };

export type GCalEventDto = {
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
};

export type GCalCalendarListItem = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone: string | null;
};

type GoogleEventRaw = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  colorId?: string;
  htmlLink?: string;
  recurringEventId?: string;
  updated?: string;
  etag?: string;
  extendedProperties?: { private?: Record<string, string> };
};

/** Map a Google Calendar API event to the app DTO (all-day uses date-only strings). */
export function mapGoogleCalendarEvent(raw: GoogleEventRaw): GCalEventDto | null {
  const id = raw.id?.trim();
  if (!id) return null;
  const allDay = Boolean(raw.start?.date && !raw.start?.dateTime);
  const start = allDay ? (raw.start?.date ?? "") : (raw.start?.dateTime ?? "");
  const end = allDay ? (raw.end?.date ?? "") : (raw.end?.dateTime ?? "");
  if (!start || !end) return null;
  const priv = raw.extendedProperties?.private ?? {};
  return {
    id,
    title: (raw.summary ?? "").trim() || "(no title)",
    description: raw.description?.trim() || null,
    location: raw.location?.trim() || null,
    start,
    end,
    allDay,
    colorId: raw.colorId?.trim() || null,
    htmlLink: raw.htmlLink?.trim() || null,
    recurringEventId: raw.recurringEventId?.trim() || null,
    updated: raw.updated?.trim() || null,
    etag: raw.etag?.trim() || null,
    authorUserId: priv.core_app_user_id?.trim() || null,
    authorUserName: priv.core_app_user_name?.trim() || null,
  };
}

export function buildGoogleEventBody(input: {
  title: string;
  description?: string | null;
  location?: string | null;
  start: string;
  end: string;
  allDay: boolean;
  timeZone?: string | null;
  authorUserId?: string | null;
  authorUserName?: string | null;
}): Record<string, unknown> {
  const timeZone = input.timeZone?.trim() || undefined;
  const start = input.allDay
    ? { date: input.start.slice(0, 10) }
    : { dateTime: input.start, ...(timeZone ? { timeZone } : {}) };
  const end = input.allDay
    ? { date: input.end.slice(0, 10) }
    : { dateTime: input.end, ...(timeZone ? { timeZone } : {}) };
  const body: Record<string, unknown> = {
    summary: input.title.trim(),
    start,
    end,
  };
  if (input.description != null) body.description = input.description;
  if (input.location != null) body.location = input.location;
  if (input.authorUserId || input.authorUserName) {
    body.extendedProperties = {
      private: {
        ...(input.authorUserId ? { core_app_user_id: input.authorUserId } : {}),
        ...(input.authorUserName ? { core_app_user_name: input.authorUserName } : {}),
      },
    };
  }
  return body;
}

export type GCalHttpError = {
  code: string;
  message: string;
  status: number;
  retryable?: boolean;
};

/** Map Google Calendar HTTP status / body to a stable API error. */
export function mapGoogleCalendarHttpError(status: number, bodyText: string): GCalHttpError {
  const lower = bodyText.toLowerCase();
  if (status === 401 || (status === 400 && /invalid_grant/i.test(lower))) {
    return { code: "reconnect_required", message: "Google authorization expired", status: 409 };
  }
  if (status === 412 || /precondition|etag/i.test(lower)) {
    return { code: "conflict", message: "Event was changed in Google Calendar", status: 409 };
  }
  if (status === 403) {
    return { code: "forbidden", message: "Google Calendar access denied", status: 403 };
  }
  if (status === 404) {
    return { code: "not_found", message: "Calendar or event not found", status: 404 };
  }
  if (status === 429) {
    return { code: "rate_limited", message: "Google Calendar rate limit", status: 429, retryable: true };
  }
  if (status >= 500) {
    return { code: "provider_error", message: "Google Calendar unavailable", status: 502, retryable: true };
  }
  return { code: "provider_error", message: bodyText.slice(0, 200) || `google_calendar_http_${status}`, status: 502 };
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function googleCalendarFetch(
  accessToken: string,
  path: string,
  init?: RequestInit & { etag?: string },
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init?.etag) headers.set("If-Match", init.etag);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = path.startsWith("http") ? path : `https://www.googleapis.com/calendar/v3${path}`;
  let attempt = 0;
  while (true) {
    attempt += 1;
    const res = await fetch(url, { ...init, headers });
    if (res.ok || attempt > 1) return res;
    if (res.status === 429 || res.status >= 500) {
      await sleep(400);
      continue;
    }
    return res;
  }
}

export async function loadWorkspaceCalendarCredential(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<{ refreshToken: string } | { reconnect: true; reason: string }> {
  const { data: secret, error } = await admin.rpc("crm_gcal_get_credential", { p_workspace_id: workspaceId });
  if (error) return { reconnect: true, reason: error.message };
  if (typeof secret !== "string" || !secret) return { reconnect: true, reason: "missing_credential" };
  try {
    const parsed = JSON.parse(secret) as GoogleCredential;
    if (parsed?.type !== "google" || !parsed.refresh_token) {
      return { reconnect: true, reason: "invalid_credential" };
    }
    return { refreshToken: parsed.refresh_token };
  } catch {
    return { reconnect: true, reason: "invalid_credential" };
  }
}

export async function clearCalendarCredentialOnAuthFailure(
  admin: SupabaseClient,
  workspaceId: string,
  lastError: string,
): Promise<void> {
  await admin.rpc("crm_gcal_clear_credential", { p_workspace_id: workspaceId });
  await admin
    .from("workspace_google_calendar")
    .update({
      last_error: lastError.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId);
}

export async function workspaceCalendarAccessToken(
  admin: SupabaseClient,
  workspaceId: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string } | { error: GCalHttpError }> {
  const cred = await loadWorkspaceCalendarCredential(admin, workspaceId);
  if ("reconnect" in cred) {
    return {
      error: { code: "reconnect_required", message: "Connect Google Calendar again", status: 409 },
    };
  }
  try {
    const accessToken = await googleAccessToken(cred.refreshToken, clientId, clientSecret);
    return { accessToken };
  } catch (error) {
    if (isGoogleAuthError(error)) {
      await clearCalendarCredentialOnAuthFailure(
        admin,
        workspaceId,
        error instanceof Error ? error.message : "invalid_grant",
      );
      return {
        error: { code: "reconnect_required", message: "Connect Google Calendar again", status: 409 },
      };
    }
    return {
      error: {
        code: "provider_error",
        message: error instanceof Error ? error.message : "token_failed",
        status: 502,
      },
    };
  }
}

/** In-memory GET events cache (per isolate, 30s). */
const eventsCache = new Map<string, { expiresAt: number; payload: unknown }>();

export function getCachedEvents(key: string): unknown | null {
  const hit = eventsCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    eventsCache.delete(key);
    return null;
  }
  return hit.payload;
}

export function setCachedEvents(key: string, payload: unknown, ttlMs = 30_000) {
  eventsCache.set(key, { expiresAt: Date.now() + ttlMs, payload });
}

export function invalidateEventsCache(workspaceId: string) {
  for (const key of eventsCache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) eventsCache.delete(key);
  }
}

export { isGoogleAuthError };
