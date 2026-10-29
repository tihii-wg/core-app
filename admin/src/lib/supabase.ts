import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-safe Supabase client using the anon key only.
 * Never pass a service-role key into Vite env or this module.
 */
let client: SupabaseClient | null = null;

export function getSupabaseConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";
  return { url, anonKey, configured: Boolean(url && anonKey) };
}

export function getSupabase(): SupabaseClient | null {
  const { url, anonKey, configured } = getSupabaseConfig();
  if (!configured) return null;
  if (!client) {
    client = createClient(url, anonKey);
  }
  return client;
}
