/** CORS helpers for Edge Functions. */

export function corsHeaders(appUrl: string | undefined): HeadersInit {
  const origin = (appUrl ?? "").replace(/\/$/, "") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-cron-token",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
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
