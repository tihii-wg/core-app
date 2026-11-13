import { exchangeGoogleAccessToken, isGoogleAuthError, type GoogleCredential } from "./googleDrive.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { resolveEventCalendarColor } from "./gcalMulti.ts";

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
  coreAppOrderId: string | null;
  coreAppField: string | null;
  calendarId: string | null;
  calendarColor: string | null;
  readOnly: boolean;
  busyOnly: boolean;
};

export type GCalCalendarListItem = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone: string | null;
  backgroundColor: string | null;
  foregroundColor: string | null;
  selected: boolean;
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

export type MapGoogleEventOpts = {
  calendarId?: string | null;
  calendarBackground?: string | null;
  readOnly?: boolean;
  busyOnly?: boolean;
};

/** Map a Google Calendar API event to the app DTO (all-day uses date-only strings). */
export function mapGoogleCalendarEvent(raw: GoogleEventRaw, opts: MapGoogleEventOpts = {}): GCalEventDto | null {
  const id = raw.id?.trim();
  if (!id) return null;
  const allDay = Boolean(raw.start?.date && !raw.start?.dateTime);
  const start = allDay ? (raw.start?.date ?? "") : (raw.start?.dateTime ?? "");
  const end = allDay ? (raw.end?.date ?? "") : (raw.end?.dateTime ?? "");
  if (!start || !end) return null;
  const priv = raw.extendedProperties?.private ?? {};
  const busyOnly = Boolean(opts.busyOnly);
  const colorId = raw.colorId?.trim() || null;
  return {
    id,
    title: busyOnly ? "" : (raw.summary ?? "").trim() || "(no title)",
    description: busyOnly ? null : raw.description?.trim() || null,
    location: busyOnly ? null : raw.location?.trim() || null,
    start,
    end,
    allDay,
    colorId,
    htmlLink: busyOnly ? null : raw.htmlLink?.trim() || null,
    recurringEventId: raw.recurringEventId?.trim() || null,
    updated: raw.updated?.trim() || null,
    etag: raw.etag?.trim() || null,
    authorUserId: priv.core_app_user_id?.trim() || null,
    authorUserName: priv.core_app_user_name?.trim() || null,
    coreAppOrderId: priv.core_app_order_id?.trim() || null,
    coreAppField: priv.core_app_field?.trim() || null,
    calendarId: opts.calendarId?.trim() || null,
    calendarColor: resolveEventCalendarColor(opts.calendarBackground, colorId),
    readOnly: Boolean(opts.readOnly) || busyOnly,
    busyOnly,
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
  coreAppOrderId?: string | null;
  coreAppField?: string | null;
  coreAppWorkspaceId?: string | null;
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
  const priv: Record<string, string> = {};
  if (input.authorUserId) priv.core_app_user_id = input.authorUserId;
  if (input.authorUserName) priv.core_app_user_name = input.authorUserName;
  if (input.coreAppOrderId) priv.core_app_order_id = input.coreAppOrderId;
  if (input.coreAppField) priv.core_app_field = input.coreAppField;
  if (input.coreAppWorkspaceId) priv.core_app_workspace_id = input.coreAppWorkspaceId;
  if (Object.keys(priv).length) {
    body.extendedProperties = { private: priv };
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
  invalidateWorkspaceCalendarAccessTokenCache(workspaceId);
  await admin.rpc("crm_gcal_clear_credential", { p_workspace_id: workspaceId });
  await admin
    .from("workspace_google_calendar")
    .update({
      last_error: lastError.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId);
}

/** Per-isolate access-token cache keyed by workspace_id (+ refresh-token fingerprint). Never log tokens. */
type CachedWorkspaceAccessToken = {
  token: string;
  expiresAt: number;
  refreshTokenHash: string;
};

const accessTokenCache = new Map<string, CachedWorkspaceAccessToken>();
const accessTokenInflight = new Map<
  string,
  Promise<{ accessToken: string } | { error: GCalHttpError }>
>();

/** Non-cryptographic fingerprint so reconnect/disconnect invalidates stale cache entries. */
export function fingerprintRefreshToken(refreshToken: string): string {
  let hash = 2166136261;
  for (let i = 0; i < refreshToken.length; i++) {
    hash ^= refreshToken.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${refreshToken.length}:${hash >>> 0}`;
}

export function invalidateWorkspaceCalendarAccessTokenCache(workspaceId: string): void {
  accessTokenCache.delete(workspaceId);
  accessTokenInflight.delete(workspaceId);
}

/** Test-only: clear all cached / in-flight tokens in this isolate. */
export function resetWorkspaceCalendarAccessTokenCacheForTests(): void {
  accessTokenCache.clear();
  accessTokenInflight.clear();
}

export async function workspaceCalendarAccessToken(
  admin: SupabaseClient,
  workspaceId: string,
  clientId: string,
  clientSecret: string,
  opts?: { forceRefresh?: boolean },
): Promise<{ accessToken: string } | { error: GCalHttpError }> {
  const cred = await loadWorkspaceCalendarCredential(admin, workspaceId);
  if ("reconnect" in cred) {
    invalidateWorkspaceCalendarAccessTokenCache(workspaceId);
    return {
      error: { code: "reconnect_required", message: "Connect Google Calendar again", status: 409 },
    };
  }

  const refreshTokenHash = fingerprintRefreshToken(cred.refreshToken);
  const forceRefresh = opts?.forceRefresh === true;

  if (forceRefresh) {
    accessTokenCache.delete(workspaceId);
    accessTokenInflight.delete(workspaceId);
  } else {
    const cached = accessTokenCache.get(workspaceId);
    if (
      cached &&
      cached.refreshTokenHash === refreshTokenHash &&
      cached.expiresAt - 60_000 > Date.now()
    ) {
      return { accessToken: cached.token };
    }
    // Refresh token changed (reconnect) — drop stale entry for this workspace only.
    if (cached && cached.refreshTokenHash !== refreshTokenHash) {
      accessTokenCache.delete(workspaceId);
    }
    const inflight = accessTokenInflight.get(workspaceId);
    if (inflight) return inflight;
  }

  const exchange = (async (): Promise<{ accessToken: string } | { error: GCalHttpError }> => {
    try {
      const { accessToken, expiresIn } = await exchangeGoogleAccessToken(
        cred.refreshToken,
        clientId,
        clientSecret,
      );
      accessTokenCache.set(workspaceId, {
        token: accessToken,
        expiresAt: Date.now() + expiresIn * 1000,
        refreshTokenHash,
      });
      return { accessToken };
    } catch (error) {
      invalidateWorkspaceCalendarAccessTokenCache(workspaceId);
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
    } finally {
      accessTokenInflight.delete(workspaceId);
    }
  })();

  accessTokenInflight.set(workspaceId, exchange);
  return exchange;
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

export function invalidateEventsCache(workspaceId: string, calendarId?: string) {
  const prefix = calendarId ? `${workspaceId}:${calendarId}:` : `${workspaceId}:`;
  for (const key of eventsCache.keys()) {
    if (key.startsWith(prefix) || (!calendarId && key.startsWith(`${workspaceId}:`))) {
      eventsCache.delete(key);
    }
  }
}

export { isGoogleAuthError };
