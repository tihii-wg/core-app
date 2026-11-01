import i18n from "../i18n";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";
import supabase from "./supabase";

/** Taxes live in `taxes` (crm_ro_v1, section 4): name, rate (percent), is_included, is_active, soft-delete via deleted_at. */
export type TaxRecord = {
  id: string;
  workspaceId: string;
  name: string;
  /** Percent, e.g. 20 for 20%. */
  rate: number;
  /** True when item prices already include this tax (VAT-inclusive). */
  isIncluded: boolean;
  isActive: boolean;
};

export type TaxInput = {
  name: string;
  rate: number;
  isIncluded: boolean;
  isActive: boolean;
};

export type TaxesResult = {
  taxes: TaxRecord[];
  /** True when the `taxes` table is not applied in this database yet (crm_ro_v1.PRODUCTION.sql). */
  isUnavailable: boolean;
};

const taxColumns = "id, workspace_id, name, rate, is_included, is_active, deleted_at";

export const MAX_TAX_RATE_PERCENT = 100;

export function toTax(row: Record<string, unknown>): TaxRecord {
  const rate = Number(row.rate);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: typeof row.name === "string" ? row.name : "",
    rate: Number.isFinite(rate) ? rate : 0,
    isIncluded: row.is_included !== false,
    isActive: row.is_active !== false,
  };
}

/** Validates and normalises a tax form. Throws a localised error for bad input. Pure. */
export function normalizeTaxInput(input: TaxInput): TaxInput {
  const name = input.name.trim();
  if (!name) throw new Error(i18n.t("settings.taxes.errors.nameRequired"));
  const rate = Math.round((Number(input.rate) + Number.EPSILON) * 1000) / 1000;
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_TAX_RATE_PERCENT) {
    throw new Error(i18n.t("settings.taxes.errors.rateRange", { max: MAX_TAX_RATE_PERCENT }));
  }
  return { name, rate, isIncluded: input.isIncluded, isActive: input.isActive };
}

function mapTaxWriteError(error: { code?: string; message?: string }) {
  if (isMissingTableError(error, "taxes")) return new Error(i18n.t("settings.taxes.errors.unavailable"));
  if (error.code === "42501") return new Error(i18n.t("settings.taxes.errors.noPermission"));
  return new Error(error.message ?? i18n.t("common.somethingWentWrong"));
}

/** Lists taxes. A missing table resolves to `{ taxes: [], isUnavailable: true }`. */
export async function getTaxes(workspaceId: string | undefined): Promise<TaxesResult> {
  const resolved = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("taxes")
    .select(taxColumns)
    .eq("workspace_id", resolved)
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (error) {
    if (isMissingTableError(error, "taxes")) return { taxes: [], isUnavailable: true };
    throw new Error(error.message);
  }
  return { taxes: ((data ?? []) as Record<string, unknown>[]).map(toTax), isUnavailable: false };
}

export async function createTax(input: TaxInput, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const clean = normalizeTaxInput(input);
  const { data, error } = await supabase
    .from("taxes")
    .insert({
      workspace_id: resolved,
      name: clean.name,
      rate: clean.rate,
      is_included: clean.isIncluded,
      is_active: clean.isActive,
    })
    .select(taxColumns)
    .single();
  if (error) throw mapTaxWriteError(error);
  return toTax(data as Record<string, unknown>);
}

export async function updateTax(id: string, input: TaxInput, workspaceId: string | undefined) {
  const resolved = requireWorkspaceId(workspaceId);
  const clean = normalizeTaxInput(input);
  const { data, error } = await supabase
    .from("taxes")
    .update({ name: clean.name, rate: clean.rate, is_included: clean.isIncluded, is_active: clean.isActive })
    .eq("workspace_id", resolved)
    .eq("id", id)
    .is("deleted_at", null)
    .select(taxColumns)
    .maybeSingle();
  if (error) throw mapTaxWriteError(error);
  if (!data) throw new Error(i18n.t("settings.taxes.errors.notFound"));
  return toTax(data as Record<string, unknown>);
}

/** The tax used to estimate VAT on documents: the first active tax-included row (highest rate wins on ties). */
export function pickDefaultIncludedTax(taxes: TaxRecord[]): TaxRecord | null {
  const candidates = taxes.filter((tax) => tax.isActive && tax.isIncluded && tax.rate > 0);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name))[0] ?? null;
}
