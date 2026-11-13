/** CORS helpers for Edge Functions. */

export function corsHeaders(appUrl: string | undefined): HeadersInit {
  const origin = (appUrl ?? "").replace(/\/$/, "") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-cron-token",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/**
 * Browser origin allowed to call a function: APP_URL, any origin in APP_EXTRA_ORIGINS
 * (comma-separated, e.g. a custom domain), or local dev (http://localhost:*).
 * Returns the normalized origin, or null when not allowed. CORS is not auth — every route still checks the JWT.
 */
export function resolveAllowedOrigin(appUrl: string | undefined, requestOrigin: string | null | undefined): string | null {
  const origin = (requestOrigin ?? "").trim().replace(/\/$/, "");
  if (!origin) return null;
  const allowed = new Set<string>();
  const app = (appUrl ?? "").trim().replace(/\/$/, "");
  if (app) allowed.add(app);
  for (const extra of (Deno.env.get("APP_EXTRA_ORIGINS") ?? "").split(",")) {
    const v = extra.trim().replace(/\/$/, "");
    if (v) allowed.add(v);
  }
  if (allowed.has(origin) || LOCAL_DEV_ORIGIN.test(origin)) return origin;
  return null;
}

/** CORS origin for this request: the caller's origin when allowed, otherwise APP_URL. */
export function corsOriginFor(appUrl: string | undefined, req: Request): string {
  return resolveAllowedOrigin(appUrl, req.headers.get("origin")) ?? (appUrl ?? "");
}

export function jsonResponse(
  body: unknown,
  status: number,
  appUrl: string | undefined,
  extraHeaders: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(appUrl),
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  appUrl: string | undefined,
): Response {
  return jsonResponse({ error: { code, message } }, status, appUrl);
}
