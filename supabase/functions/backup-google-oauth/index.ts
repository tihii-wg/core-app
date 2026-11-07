import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { oauthStateExpiresAt, signOAuthState, verifyOAuthState } from "../_shared/crypto.ts";
import { bearerToken, requireEnv, serviceClient, userClient } from "../_shared/supabase.ts";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file email";

Deno.serve(async (req) => {
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(appUrl) });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  try {
    if (path.endsWith("/start") && req.method === "GET") {
      return await handleStart(req, url, appUrl);
    }
    if (path.endsWith("/callback") && req.method === "GET") {
      return await handleCallback(url, appUrl);
    }
    // Allow bare function URL with ?action=start for invoke-style calls
    if (req.method === "POST") {
      const body = (await req.json()) as { workspaceId?: string; locale?: string };
      return await handleStartPost(req, body.workspaceId ?? "", body.locale ?? "en", appUrl);
    }
    return errorResponse("not_found", "Unknown route", 404, appUrl);
  } catch (error) {
    console.error("[backup-google-oauth]", error instanceof Error ? error.message : error);
    return errorResponse("provider_error", error instanceof Error ? error.message : "OAuth failed", 500, appUrl);
  }
});

async function handleStart(req: Request, url: URL, appUrl: string): Promise<Response> {
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  const locale = url.searchParams.get("locale")?.trim() || "en";
  return handleStartPost(req, workspaceId, locale, appUrl);
}

async function handleStartPost(req: Request, workspaceId: string, locale: string, appUrl: string): Promise<Response> {
  if (!workspaceId) return errorResponse("invalid_args", "workspaceId required", 400, appUrl);
  const jwt = bearerToken(req);
  if (!jwt) return errorResponse("unauthorized", "Missing bearer token", 401, appUrl);

  const user = userClient(jwt);
  const { data: userData, error: userError } = await user.auth.getUser(jwt);
  if (userError || !userData.user) return errorResponse("unauthorized", "Invalid session", 401, appUrl);

  const { data: isOwner } = await user.rpc("crm_is_workspace_owner_id", { p_workspace_id: workspaceId });
  if (isOwner !== true) return errorResponse("owner_only", "Only the workspace owner can connect Google Drive", 403, appUrl);

  const state = await signOAuthState(
    {
      workspaceId,
      userId: userData.user.id,
      exp: oauthStateExpiresAt(),
      nonce: crypto.randomUUID(),
      locale,
    },
    requireEnv("BACKUP_OAUTH_STATE_SECRET"),
  );

  const redirectUri = `${requireEnv("SUPABASE_URL").replace(/\/$/, "")}/functions/v1/backup-google-oauth/callback`;
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return jsonResponse({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }, 200, appUrl);
}

async function handleCallback(url: URL, appUrl: string): Promise<Response> {
  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  const oauthError = url.searchParams.get("error");

  const fallback = `${appUrl}/en/settings?tab=backups&error=oauth`;
  if (oauthError || !code || !state) {
    return Response.redirect(`${appUrl}/en/settings?tab=backups&error=${encodeURIComponent(oauthError || "oauth")}`, 302);
  }

  const payload = await verifyOAuthState(state, requireEnv("BACKUP_OAUTH_STATE_SECRET"));
  if (!payload) {
    return Response.redirect(`${appUrl}/en/settings?tab=backups&error=invalid_state`, 302);
  }

  const locale = payload.locale || "en";
  const redirectBase = `${appUrl}/${locale}/${payload.workspaceId}/settings?tab=backups`;

  try {
    const redirectUri = `${requireEnv("SUPABASE_URL").replace(/\/$/, "")}/functions/v1/backup-google-oauth/callback`;
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
      return Response.redirect(`${redirectBase}&error=${encodeURIComponent(tokenJson.error || "token")}`, 302);
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
    const secret = JSON.stringify({ type: "google", refresh_token: tokenJson.refresh_token });
    const { error: setError } = await admin.rpc("crm_backup_set_credential", {
      p_workspace_id: payload.workspaceId,
      p_secret: secret,
    });
    if (setError) {
      return Response.redirect(`${redirectBase}&error=credential`, 302);
    }

    await admin.from("workspace_backup_settings").upsert(
      {
        workspace_id: payload.workspaceId,
        provider: "google_drive",
        google_account_email: email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    );

    return Response.redirect(`${redirectBase}&connected=google`, 302);
  } catch {
    return Response.redirect(fallback, 302);
  }
}
