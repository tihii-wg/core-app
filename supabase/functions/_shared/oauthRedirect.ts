/** Build post-OAuth redirect URLs for backup Google Drive connect (pure). */

export type BackupOAuthRedirectInput = {
  appUrl: string;
  error?: string;
  connected?: string;
  /** Prefer workspace from verified/peeked state. */
  workspaceId?: string | null;
  locale?: string | null;
  /** Fallback query params from the start/callback URL. */
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
  // UUID or opaque id — keep path-safe characters only
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(raw)) return null;
  return raw;
}

/**
 * Success/error redirect after Google OAuth.
 * Prefer `<app>/<locale>/<workspaceId>/settings?tab=backups…`;
 * otherwise `<app>/?error=…` (or bare app root with query).
 */
export function buildBackupOAuthRedirect(input: BackupOAuthRedirectInput): string {
  const base = (input.appUrl ?? "").replace(/\/$/, "");
  const workspaceId = sanitizeWorkspaceId(input.workspaceId) ?? sanitizeWorkspaceId(input.ws);
  const locale = sanitizeLocale(input.locale ?? input.localeParam);
  const params = new URLSearchParams({ tab: "backups" });
  if (input.connected) params.set("connected", input.connected);
  if (input.error) params.set("error", input.error);

  if (base && workspaceId) {
    return `${base}/${locale}/${workspaceId}/settings?${params}`;
  }
  if (base) {
    const rootParams = new URLSearchParams();
    if (input.error) rootParams.set("error", input.error);
    if (input.connected) rootParams.set("connected", input.connected);
    const qs = rootParams.toString();
    return qs ? `${base}/?${qs}` : `${base}/`;
  }
  return `/?${params}`;
}
