import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { oauthStateExpiresAt, peekOAuthState, signOAuthState, verifyOAuthState } from "../_shared/crypto.ts";
import { buildCalendarOAuthRedirect } from "../_shared/calendarOAuthRedirect.ts";
import { type GoogleCredential, googleAccessToken } from "../_shared/googleDrive.ts";
import { oauthStateSecret } from "../_shared/oauthStateSecret.ts";
import { bearerToken, requireEnv, serviceClient, userClient } from "../_shared/supabase.ts";

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "email",
].join(" ");

Deno.serve(async (req) => {
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(appUrl) });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  try {
    if (path.endsWith("/start") && (req.method === "GET" || req.method === "POST")) {
      if (req.method === "GET") {
        const workspaceId = url.searchParams.get("workspaceId")?.trim() || "";
        const locale = url.searchParams.get("locale")?.trim() || "en";
        return await handleStart(req, workspaceId, locale, appUrl);
      }
      const body = (await req.json()) as { workspaceId?: string; locale?: string };
      return await handleStart(req, body.workspaceId ?? "", body.locale ?? "en", appUrl);
    }
    if (path.endsWith("/callback") && req.method === "GET") {
      return await handleCallback(url, appUrl);
    }
    if (path.endsWith("/disconnect") && req.method === "POST") {
      const body = (await req.json()) as { workspaceId?: string };
      return await handleDisconnect(req, body.workspaceId ?? "", appUrl);
    }
    if (req.method === "POST" && !path.includes("/callback") && !path.includes("/disconnect")) {
      const body = (await req.json()) as { workspaceId?: string; locale?: string };
      return await handleStart(req, body.workspaceId ?? "", body.locale ?? "en", appUrl);
    }
    return errorResponse("not_found", "Unknown route", 404, appUrl);
  } catch (error) {
    console.error("[google-calendar-oauth]", error instanceof Error ? error.message : error);
    return errorResponse("provider_error", error instanceof Error ? error.message : "OAuth failed", 500, appUrl);
  }
});

async function handleStart(req: Request, workspaceId: string, locale: string, appUrl: string): Promise<Response> {
  if (!workspaceId) return errorResponse("invalid_args", "workspaceId required", 400, appUrl);
  const jwt = bearerToken(req);
  if (!jwt) return errorResponse("unauthorized", "Missing bearer token", 401, appUrl);

  const user = userClient(jwt);
  const { data: userData, error: userError } = await user.auth.getUser(jwt);
  if (userError || !userData.user) return errorResponse("unauthorized", "Invalid session", 401, appUrl);

  const { data: isOwner } = await user.rpc("crm_is_workspace_owner_id", { p_workspace_id: workspaceId });
  if (isOwner !== true) {
    return errorResponse("owner_only", "Only the workspace owner can connect Google Calendar", 403, appUrl);
  }

  const state = await signOAuthState(
    {
      workspaceId,
      userId: userData.user.id,
      exp: oauthStateExpiresAt(),
      nonce: crypto.randomUUID(),
      locale,
    },
    oauthStateSecret(),
  );

  const redirectUri = `${requireEnv("SUPABASE_URL").replace(/\/$/, "")}/functions/v1/google-calendar-oauth/callback`;
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return jsonResponse({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }, 200, appUrl);
}

async function resolveCallbackContext(url: URL, state: string, secret: string) {
  const peeked = state ? await peekOAuthState(state, secret) : null;
  return {
    workspaceId: peeked?.workspaceId ?? url.searchParams.get("ws"),
    locale: peeked?.locale ?? url.searchParams.get("locale"),
  };
}

async function handleCallback(url: URL, appUrl: string): Promise<Response> {
  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  const oauthError = url.searchParams.get("error");
  const secret = oauthStateSecret();
  const ctx = await resolveCallbackContext(url, state, secret);

  const errorRedirect = (reason: string) =>
    Response.redirect(
      buildCalendarOAuthRedirect({
        appUrl,
        gcal: "error",
        reason,
        workspaceId: ctx.workspaceId,
        locale: ctx.locale,
        ws: url.searchParams.get("ws"),
        localeParam: url.searchParams.get("locale"),
      }),
      302,
    );

  if (oauthError || !code || !state) return errorRedirect(oauthError || "oauth");

  const payload = await verifyOAuthState(state, secret);
  if (!payload) return errorRedirect("invalid_state");

  try {
    const redirectUri = `${requireEnv("SUPABASE_URL").replace(/\/$/, "")}/functions/v1/google-calendar-oauth/callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: requireEnv("GOOGLE_CLIENT_ID"),
        client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenJson = (await tokenRes.json()) as {
      refresh_token?: string;
      access_token?: string;
      error?: string;
    };
    if (!tokenRes.ok || !tokenJson.refresh_token) {
      return Response.redirect(
        buildCalendarOAuthRedirect({
          appUrl,
          gcal: "error",
          reason: tokenJson.error || "token",
          workspaceId: payload.workspaceId,
          locale: payload.locale,
        }),
        302,
      );
    }

    let email: string | null = null;
    if (tokenJson.access_token) {
      const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (infoRes.ok) {
        const info = (await infoRes.json()) as { email?: string };
        email = info.email?.trim() || null;
      }
    }

    const admin = serviceClient();
    const credential: GoogleCredential = { type: "google", refresh_token: tokenJson.refresh_token };
    const { error: setError } = await admin.rpc("crm_gcal_set_credential", {
      p_workspace_id: payload.workspaceId,
      p_secret: JSON.stringify(credential),
    });
    if (setError) {
      return Response.redirect(
        buildCalendarOAuthRedirect({
          appUrl,
          gcal: "error",
          reason: "credential",
          workspaceId: payload.workspaceId,
          locale: payload.locale,
        }),
        302,
      );
    }

    let calendarSummary: string | null = "Primary";
    let calendarTimeZone: string | null = null;
    try {
      const accessToken = await googleAccessToken(
        tokenJson.refresh_token,
        requireEnv("GOOGLE_CLIENT_ID"),
        requireEnv("GOOGLE_CLIENT_SECRET"),
      );
      const calRes = await fetch(
        "https://www.googleapis.com/calendar/v3/calendars/primary?fields=id,summary,timeZone",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (calRes.ok) {
        const cal = (await calRes.json()) as { summary?: string; timeZone?: string };
        calendarSummary = cal.summary?.trim() || "Primary";
        calendarTimeZone = cal.timeZone?.trim() || null;
      }
    } catch (error) {
      console.error("[google-calendar-oauth] primary meta", error instanceof Error ? error.message : error);
    }

    await admin.from("workspace_google_calendar").upsert(
      {
        workspace_id: payload.workspaceId,
        google_email: email,
        calendar_id: "primary",
        calendar_summary: calendarSummary,
        calendar_time_zone: calendarTimeZone,
        connected_by: payload.userId,
        connected_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    );

    return Response.redirect(
      buildCalendarOAuthRedirect({
        appUrl,
        gcal: "connected",
        workspaceId: payload.workspaceId,
        locale: payload.locale,
      }),
      302,
    );
  } catch (error) {
    console.error("[google-calendar-oauth] callback", error instanceof Error ? error.message : error);
    return errorRedirect("oauth");
  }
}

async function handleDisconnect(req: Request, workspaceId: string, appUrl: string): Promise<Response> {
  if (!workspaceId) return errorResponse("invalid_args", "workspaceId required", 400, appUrl);
  const jwt = bearerToken(req);
  if (!jwt) return errorResponse("unauthorized", "Missing bearer token", 401, appUrl);

  const user = userClient(jwt);
  const { data: userData, error: userError } = await user.auth.getUser(jwt);
  if (userError || !userData.user) return errorResponse("unauthorized", "Invalid session", 401, appUrl);

  const { data: isOwner } = await user.rpc("crm_is_workspace_owner_id", { p_workspace_id: workspaceId });
  if (isOwner !== true) {
    return errorResponse("owner_only", "Only the workspace owner can disconnect Google Calendar", 403, appUrl);
  }

  const admin = serviceClient();

  try {
    const { data: secret } = await admin.rpc("crm_gcal_get_credential", { p_workspace_id: workspaceId });
    if (typeof secret === "string" && secret) {
      const parsed = JSON.parse(secret) as GoogleCredential;
      if (parsed?.type === "google" && parsed.refresh_token) {
        await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: parsed.refresh_token }),
        });
      }
    }
  } catch (error) {
    console.error("[google-calendar-oauth] revoke", error instanceof Error ? error.message : error);
  }

  const { error: clearError } = await admin.rpc("crm_gcal_clear_credential", { p_workspace_id: workspaceId });
  if (clearError) {
    return errorResponse("provider_error", clearError.message || "Failed to disconnect", 500, appUrl);
  }
  await admin.from("workspace_google_calendar").delete().eq("workspace_id", workspaceId);

  return jsonResponse({ ok: true }, 200, appUrl);
}
