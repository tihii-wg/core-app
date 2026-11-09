/** Post-OAuth redirect for order-photo Google Drive connect. */

export type PhotosOAuthRedirectInput = {
  appUrl: string;
  gdrive: "connected" | "error";
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
 * Success/error redirect after photos Google OAuth.
 * `{APP_URL}/{locale}/{workspaceId}/settings?tab=storage&gdrive=connected|error&reason=…`
 */
export function buildPhotosOAuthRedirect(input: PhotosOAuthRedirectInput): string {
  const base = (input.appUrl ?? "").replace(/\/$/, "");
  const workspaceId = sanitizeWorkspaceId(input.workspaceId) ?? sanitizeWorkspaceId(input.ws);
  const locale = sanitizeLocale(input.locale ?? input.localeParam);
  const params = new URLSearchParams({ tab: "storage", gdrive: input.gdrive });
  if (input.reason) params.set("reason", input.reason.slice(0, 80));

  if (base && workspaceId) {
    return `${base}/${locale}/${workspaceId}/settings?${params}`;
  }
  if (base) {
    return `${base}/?${params}`;
  }
  return `/?${params}`;
}
