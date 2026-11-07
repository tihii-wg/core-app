import { getTaxes, pickDefaultIncludedTax } from "./apiTaxes";
import supabase from "./supabase";

/**
 * Current workspace VAT rate percent (highest active included tax).
 * Prefers `crm_workspace_vat_rate`; falls back to taxes list. Null when no rate is configured.
 */
export async function getWorkspaceVatRate(workspaceId: string | undefined): Promise<number | null> {
  if (!workspaceId) return null;
  const { data, error } = await supabase.rpc("crm_workspace_vat_rate", { p_workspace_id: workspaceId });
  if (!error && data != null && data !== "") {
    const rate = Number(data);
    if (Number.isFinite(rate) && rate > 0) return rate;
  }
  try {
    const taxes = await getTaxes(workspaceId);
    return pickDefaultIncludedTax(taxes.taxes)?.rate ?? null;
  } catch {
    return null;
  }
}
