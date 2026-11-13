/** Post-OAuth redirect for shared Google Calendar connect. */

export type CalendarOAuthRedirectInput = {
  appUrl: string;
  gcal: "connected" | "error";
  reason?: string;
  workspaceId?: string | null;
  locale?: string | null;
  ws?: string | null;
  localeParam?: string | null;
};

function sanitizeLocale(value: string | null | undefined): string {
  const raw = (value ?? "").trim().toLowerCase();
  if (/^[a-z]{2}(-[a-z]{2})?$/.test(raw)) return raw.split("-")[0]!;
  return "en";
}

function sanitizeWorkspaceId(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(raw)) return null;
  return raw;
}

/**
 * Success/error redirect after Calendar Google OAuth.
 * Success: `{APP_URL}/{locale}/{workspaceId}/calendar?gcal=connected`
 * Error:   `{APP_URL}/{locale}/{workspaceId}/calendar?gcal_error=<code>`
 */
export function buildCalendarOAuthRedirect(input: CalendarOAuthRedirectInput): string {
  const base = (input.appUrl ?? "").replace(/\/$/, "");
  const workspaceId = sanitizeWorkspaceId(input.workspaceId) ?? sanitizeWorkspaceId(input.ws);
  const locale = sanitizeLocale(input.locale ?? input.localeParam);
  const params = new URLSearchParams();
  if (input.gcal === "connected") {
    params.set("gcal", "connected");
  } else {
    params.set("gcal_error", (input.reason || "oauth").slice(0, 80));
  }

  if (base && workspaceId) {
    return `${base}/${locale}/${workspaceId}/calendar?${params}`;
  }
  if (base) {
    return `${base}/?${params}`;
  }
  return `/?${params}`;
}
