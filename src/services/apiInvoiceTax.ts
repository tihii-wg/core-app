import supabase from "./supabase";

/**
 * Best-effort read of `invoices.tax_total` (added by crm_ro_v1.PRODUCTION.sql). Kept out of the main invoice
 * select so databases without the column keep working: any error (missing column, RLS) resolves to null.
 */
export async function getInvoiceTaxTotal(invoiceId: string, workspaceId: string | undefined): Promise<number | null> {
  if (!invoiceId || !workspaceId) return null;
  const { data, error } = await supabase
    .from("invoices")
    .select("tax_total")
    .eq("workspace_id", workspaceId)
    .eq("id", invoiceId)
    .maybeSingle();
  if (error || !data) return null;
  const value = (data as { tax_total?: unknown }).tax_total;
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
