import i18n from "../i18n";
import supabase from "./supabase";

export type LegalEntity = {
  id: string;
  workspaceId: string;
  legalName: string;
  address: string;
  registrationNumber: string;
  taxNumber: string;
  billingEmail: string;
  iban: string;
  bankName: string;
  bankCode: string;
  additionalInfo: string;
  isDefault: boolean;
};

export type LegalEntityInput = {
  legalName: string;
  address?: string;
  registrationNumber?: string;
  taxNumber?: string;
  billingEmail?: string;
  iban?: string;
  bankName?: string;
  bankCode?: string;
  additionalInfo?: string;
  isDefault?: boolean;
};

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toLegalEntity(row: Record<string, unknown>): LegalEntity {
  return {
    id: String(row.id),
    workspaceId: text(row.workspace_id),
    legalName: text(row.legal_name),
    address: text(row.address),
    registrationNumber: text(row.registration_number),
    taxNumber: text(row.tax_number),
    billingEmail: text(row.billing_email),
    iban: text(row.iban),
    bankName: text(row.bank_name),
    bankCode: text(row.bank_code),
    additionalInfo: text(row.additional_info),
    isDefault: Boolean(row.is_default),
  };
}

function recordFromInput(input: LegalEntityInput) {
  const legalName = input.legalName.trim();
  if (!legalName) throw new Error(i18n.t("settings.general.legalEntities.validation.nameRequired"));
  return {
    legal_name: legalName,
    address: input.address?.trim() || null,
    registration_number: input.registrationNumber?.trim() || null,
    tax_number: input.taxNumber?.trim() || null,
    billing_email: input.billingEmail?.trim() || null,
    iban: input.iban?.trim() || null,
    bank_name: input.bankName?.trim() || null,
    bank_code: input.bankCode?.trim() || null,
    additional_info: input.additionalInfo?.trim() || null,
    is_default: Boolean(input.isDefault),
    updated_at: new Date().toISOString(),
  };
}

function unavailable(error: { code?: string; message?: string }) {
  return error.code === "PGRST205" || error.code === "42P01" || error.message?.includes("legal_entities") === true;
}

export async function getLegalEntities(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  const { data, error } = await supabase
    .from("legal_entities")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("legal_name", { ascending: true });

  if (error) {
    if (unavailable(error)) return [] as LegalEntity[];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toLegalEntity);
}

export async function createLegalEntity(workspaceId: string, input: LegalEntityInput) {
  const payload = recordFromInput(input);
  if (payload.is_default) {
    await supabase.from("legal_entities").update({ is_default: false }).eq("workspace_id", workspaceId).is("deleted_at", null);
  }
  const { data, error } = await supabase
    .from("legal_entities")
    .insert({ workspace_id: workspaceId, ...payload })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toLegalEntity(data as Record<string, unknown>);
}

export async function updateLegalEntity(workspaceId: string, entityId: string, input: LegalEntityInput) {
  const payload = recordFromInput(input);
  if (payload.is_default) {
    await supabase.from("legal_entities").update({ is_default: false }).eq("workspace_id", workspaceId).is("deleted_at", null).neq("id", entityId);
  }
  const { data, error } = await supabase
    .from("legal_entities")
    .update(payload)
    .eq("id", entityId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(i18n.t("settings.company.ownerOnly"));
  return toLegalEntity(data as Record<string, unknown>);
}

export async function softDeleteLegalEntity(workspaceId: string, entityId: string) {
  const { data, error } = await supabase
    .from("legal_entities")
    .update({ deleted_at: new Date().toISOString(), is_default: false, updated_at: new Date().toISOString() })
    .eq("id", entityId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(i18n.t("settings.company.ownerOnly"));
  return { id: entityId };
}
