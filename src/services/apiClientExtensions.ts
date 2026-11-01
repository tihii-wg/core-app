import i18n from "../i18n";
import { isMissingTableError } from "./missingTable";
import supabase from "./supabase";

/**
 * Client card extensions backed by crm_ro_v1 tables
 * (`client_phones`, `client_addresses`, `client_balance_entries`).
 * When a table is missing or not readable (older database, RLS) the loaders
 * resolve to `{ available: false, rows: [] }` instead of throwing.
 * Phones/addresses also have write helpers; balance entries stay read-only (ledger rows).
 */
export type ClientExtensionResult<T> = { available: boolean; rows: T[] };

export type ClientPhone = {
  id: string;
  phone: string;
  label: string | null;
  isPrimary: boolean;
  hasWhatsapp: boolean;
  allowSms: boolean;
};

export type ClientAddress = {
  id: string;
  label: string | null;
  address: string;
  isDefault: boolean;
};

export type ClientBalanceEntry = {
  id: string;
  amount: number;
  currencyCode: string;
  documentType: string | null;
  description: string | null;
  isAdjustment: boolean;
  createdAt: string;
};

export const CLIENT_BALANCE_ENTRIES_LIMIT = 50;

function requireWorkspaceId(workspaceId: string | undefined) {
  const id = workspaceId?.trim() ?? "";
  if (!id) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return id;
}

function unavailable<T>(): ClientExtensionResult<T> {
  return { available: false, rows: [] };
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown) {
  const trimmed = text(value).trim();
  return trimmed || null;
}

export function toClientPhone(row: Record<string, unknown>): ClientPhone {
  return {
    id: String(row.id),
    phone: text(row.phone),
    label: optionalText(row.label),
    isPrimary: Boolean(row.is_primary),
    hasWhatsapp: Boolean(row.has_whatsapp),
    allowSms: row.allow_sms !== false,
  };
}

export function toClientAddress(row: Record<string, unknown>): ClientAddress {
  return {
    id: String(row.id),
    label: optionalText(row.label),
    address: text(row.address),
    isDefault: Boolean(row.is_default),
  };
}

export function toClientBalanceEntry(row: Record<string, unknown>): ClientBalanceEntry {
  return {
    id: String(row.id),
    amount: Number(row.amount ?? 0),
    currencyCode: text(row.currency_code) || "MDL",
    documentType: optionalText(row.document_type),
    description: optionalText(row.description),
    isAdjustment: Boolean(row.is_adjustment),
    createdAt: text(row.created_at),
  };
}

const phoneColumns = "id, client_id, phone, label, is_primary, has_whatsapp, allow_sms, created_at";
const addressColumns = "id, client_id, label, address, is_default, created_at";
const balanceColumns = "id, client_id, amount, currency_code, document_type, description, is_adjustment, created_at";

export async function getClientPhones(workspaceId: string | undefined, clientId: string): Promise<ClientExtensionResult<ClientPhone>> {
  const resolved = requireWorkspaceId(workspaceId);
  if (!clientId.trim()) return unavailable();

  const { data, error } = await supabase
    .from("client_phones")
    .select(phoneColumns)
    .eq("workspace_id", resolved)
    .eq("client_id", clientId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) return unavailable();
  return { available: true, rows: ((data ?? []) as Record<string, unknown>[]).map(toClientPhone) };
}

export async function getClientAddresses(workspaceId: string | undefined, clientId: string): Promise<ClientExtensionResult<ClientAddress>> {
  const resolved = requireWorkspaceId(workspaceId);
  if (!clientId.trim()) return unavailable();

  const { data, error } = await supabase
    .from("client_addresses")
    .select(addressColumns)
    .eq("workspace_id", resolved)
    .eq("client_id", clientId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) return unavailable();
  return { available: true, rows: ((data ?? []) as Record<string, unknown>[]).map(toClientAddress) };
}

export async function getClientBalanceEntries(
  workspaceId: string | undefined,
  clientId: string,
): Promise<ClientExtensionResult<ClientBalanceEntry>> {
  const resolved = requireWorkspaceId(workspaceId);
  if (!clientId.trim()) return unavailable();

  const { data, error } = await supabase
    .from("client_balance_entries")
    .select(balanceColumns)
    .eq("workspace_id", resolved)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(CLIENT_BALANCE_ENTRIES_LIMIT);

  if (error) return unavailable();
  return { available: true, rows: ((data ?? []) as Record<string, unknown>[]).map(toClientBalanceEntry) };
}

// ---------------------------------------------------------------------------
// Writes (client_phones / client_addresses)
// ---------------------------------------------------------------------------

export type CreateClientPhoneInput = {
  phone: string;
  label?: string | null;
  isPrimary?: boolean;
  allowSms?: boolean;
};

export type CreateClientAddressInput = {
  address: string;
  label?: string | null;
  isDefault?: boolean;
};

type ExtensionTable = "client_phones" | "client_addresses";

/** Maps a write error to a user-facing i18n error; missing table gets a dedicated message. */
function writeError(error: { code?: string; message?: string }, table: ExtensionTable) {
  if (isMissingTableError(error, table)) return new Error(i18n.t("clients.extras.errors.tableMissing"));
  return new Error(error.message || i18n.t("clients.extras.errors.writeFailed"));
}

function requireClientId(clientId: string) {
  const id = clientId.trim();
  if (!id) throw new Error(i18n.t("clients.extras.errors.noClient"));
  return id;
}

export async function createClientPhone(
  workspaceId: string | undefined,
  clientId: string,
  input: CreateClientPhoneInput,
): Promise<ClientPhone> {
  const resolved = requireWorkspaceId(workspaceId);
  const client = requireClientId(clientId);
  const phone = input.phone.trim();
  if (!phone) throw new Error(i18n.t("clients.extras.errors.phoneRequired"));

  if (input.isPrimary) {
    // Only one primary phone per client: demote the others first.
    const { error: demoteError } = await supabase
      .from("client_phones")
      .update({ is_primary: false })
      .eq("workspace_id", resolved)
      .eq("client_id", client)
      .eq("is_primary", true);
    if (demoteError) throw writeError(demoteError, "client_phones");
  }

  const { data, error } = await supabase
    .from("client_phones")
    .insert({
      workspace_id: resolved,
      client_id: client,
      phone,
      label: input.label?.trim() || null,
      is_primary: input.isPrimary ?? false,
      allow_sms: input.allowSms ?? true,
    })
    .select(phoneColumns)
    .single();

  if (error) throw writeError(error, "client_phones");
  return toClientPhone(data as Record<string, unknown>);
}

export async function createClientAddress(
  workspaceId: string | undefined,
  clientId: string,
  input: CreateClientAddressInput,
): Promise<ClientAddress> {
  const resolved = requireWorkspaceId(workspaceId);
  const client = requireClientId(clientId);
  const address = input.address.trim();
  if (!address) throw new Error(i18n.t("clients.extras.errors.addressRequired"));

  if (input.isDefault) {
    const { error: demoteError } = await supabase
      .from("client_addresses")
      .update({ is_default: false })
      .eq("workspace_id", resolved)
      .eq("client_id", client)
      .eq("is_default", true);
    if (demoteError) throw writeError(demoteError, "client_addresses");
  }

  const { data, error } = await supabase
    .from("client_addresses")
    .insert({
      workspace_id: resolved,
      client_id: client,
      address,
      label: input.label?.trim() || null,
      is_default: input.isDefault ?? false,
    })
    .select(addressColumns)
    .single();

  if (error) throw writeError(error, "client_addresses");
  return toClientAddress(data as Record<string, unknown>);
}

/**
 * crm_ro_v1 `client_phones` has no `deleted_at` column, so this is a hard delete
 * (rows are contact details, not ledger data).
 */
export async function deleteClientPhone(workspaceId: string | undefined, clientId: string, phoneId: string): Promise<void> {
  const resolved = requireWorkspaceId(workspaceId);
  const { error } = await supabase
    .from("client_phones")
    .delete()
    .eq("workspace_id", resolved)
    .eq("client_id", requireClientId(clientId))
    .eq("id", phoneId);
  if (error) throw writeError(error, "client_phones");
}

/** Hard delete: `client_addresses` has no `deleted_at` column in crm_ro_v1. */
export async function deleteClientAddress(workspaceId: string | undefined, clientId: string, addressId: string): Promise<void> {
  const resolved = requireWorkspaceId(workspaceId);
  const { error } = await supabase
    .from("client_addresses")
    .delete()
    .eq("workspace_id", resolved)
    .eq("client_id", requireClientId(clientId))
    .eq("id", addressId);
  if (error) throw writeError(error, "client_addresses");
}
