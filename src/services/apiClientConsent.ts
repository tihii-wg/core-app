import supabase from "./supabase";

export type ClientConsentSummary = {
  total: number;
  /** Clients with `phone_notifications_consent = true` (gates SMS / calls). */
  phoneConsent: number;
  /** Clients with `email_notifications_consent = true` (gates email). */
  emailConsent: number;
};

async function countClients(workspaceId: string, consentColumn?: string) {
  let query = supabase
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);
  if (consentColumn) query = query.eq(consentColumn, true);
  const { count, error } = await query;
  if (error) return null;
  return count ?? 0;
}

/**
 * Consent counts from `clients.phone_notifications_consent` / `email_notifications_consent`
 * (general-settings SQL; crm_ro_v1 has no `allow_sms` / `allow_email` columns). Best-effort: resolves to
 * null when the columns are not applied, so the UI shows only the static consent note.
 */
export async function getClientConsentSummary(workspaceId: string | undefined): Promise<ClientConsentSummary | null> {
  const id = workspaceId?.trim();
  if (!id) return null;
  const [total, phoneConsent, emailConsent] = await Promise.all([
    countClients(id),
    countClients(id, "phone_notifications_consent"),
    countClients(id, "email_notifications_consent"),
  ]);
  if (total == null || phoneConsent == null || emailConsent == null) return null;
  return { total, phoneConsent, emailConsent };
}
