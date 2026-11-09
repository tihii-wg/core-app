import { requireEnv } from "./supabase.ts";

/** Prefer OAUTH_STATE_SECRET; fall back to the existing backup secret. */
export function oauthStateSecret(): string {
  const primary = Deno.env.get("OAUTH_STATE_SECRET")?.trim() ?? "";
  if (primary) return primary;
  return requireEnv("BACKUP_OAUTH_STATE_SECRET");
}
