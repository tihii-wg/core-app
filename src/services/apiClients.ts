import type { Client, ClientListFilter, ClientType, CreateClientInput, UpdateClientInput } from "../lib/types";
import i18n from "../i18n";
import supabase from "./supabase";
import { searchTerm } from "./searchTerm";

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown) {
  const text = textValue(value).trim();
  return text || null;
}

export function toClientType(value: unknown): ClientType | null {
  return value === "individual" || value === "organization" ? value : null;
}

export function toClient(row: Record<string, unknown>): Client {
  return {
    id: textValue(row.id),
    name: textValue(row.name),
    email: textValue(row.email),
    phone: textValue(row.phone),
    address: textValue(row.address),
    balance: Number(row.balance ?? 0),
    created_at: textValue(row.created_at),
    notes: textValue(row.notes),
    client_type: toClientType(row.client_type),
    tax_id: optionalText(row.tax_id),
    contact_person: optionalText(row.contact_person),
    middleName: optionalText(row.middle_name),
    phoneNotificationsConsent: Boolean(row.phone_notifications_consent),
    emailNotificationsConsent: Boolean(row.email_notifications_consent),
  };
}

function clientRecord(input: {
  clientName: string;
  email: string;
  phone: string;
  address?: string;
  notes?: string;
  clientType?: ClientType;
  taxId?: string | null;
  contactPerson?: string | null;
  middleName?: string | null;
  phoneNotificationsConsent?: boolean;
  emailNotificationsConsent?: boolean;
}) {
  const clientType: ClientType = input.clientType === "organization" ? "organization" : "individual";

  return {
    name: input.clientName.trim(),
    email: input.email.trim(),
    phone: input.phone.trim(),
    address: input.address?.trim() ?? "",
    notes: input.notes?.trim() ?? "",
    client_type: clientType,
    tax_id: clientType === "organization" ? optionalText(input.taxId) : null,
    contact_person: clientType === "organization" ? optionalText(input.contactPerson) : null,
    middle_name: optionalText(input.middleName),
    phone_notifications_consent: Boolean(input.phoneNotificationsConsent),
    email_notifications_consent: Boolean(input.emailNotificationsConsent),
  };
}

export async function createClient({
  workspace_id,
  clientName,
  email,
  phone,
  address,
  notes,
  clientType,
  taxId,
  contactPerson,
  middleName,
  phoneNotificationsConsent,
  emailNotificationsConsent,
}: CreateClientInput) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);
  if (!user) throw new Error(i18n.t("clients.errors.notAuthenticated"));
  if (!workspace_id) throw new Error(i18n.t("common.errors.noActiveWorkspace"));

  const { data, error } = await supabase
    .from("clients")
    .insert([
      {
        workspace_id,
        ...clientRecord({
          clientName,
          email,
          phone,
          address,
          notes,
          clientType,
          taxId,
          contactPerson,
          middleName,
          phoneNotificationsConsent,
          emailNotificationsConsent,
        }),
        added_by: user.id,
      },
    ])
    .select();

  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, unknown>[]).map(toClient);
}

export async function getClients(search: string, workspaceId: string | undefined, clientType: ClientListFilter = "all") {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));

  let query = supabase.from("clients").select("*").eq("workspace_id", workspaceId).is("deleted_at", null);

  const term = searchTerm(search);
  if (term) {
    query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,tax_id.ilike.%${term}%,contact_person.ilike.%${term}%,address.ilike.%${term}%`);
  }

  if (clientType === "individual" || clientType === "organization") {
    query = query.eq("client_type", clientType);
  }

  let { data: clients, error } = await query;

  // Before the General Settings SQL is applied, deleted_at may not exist yet.
  if (error && (error.code === "42703" || error.code === "PGRST204") && error.message?.includes("deleted_at")) {
    let fallback = supabase.from("clients").select("*").eq("workspace_id", workspaceId);
    if (term) {
      fallback = fallback.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,tax_id.ilike.%${term}%,contact_person.ilike.%${term}%,address.ilike.%${term}%`);
    }
    if (clientType === "individual" || clientType === "organization") {
      fallback = fallback.eq("client_type", clientType);
    }
    ({ data: clients, error } = await fallback);
  }

  if (error) throw new Error(error.message);

  return ((clients ?? []) as Record<string, unknown>[]).map(toClient);
}

export async function getClient(workspaceId: string | undefined, clientId: string) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  const id = clientId.trim();
  if (!id) return null;

  let { data, error } = await supabase.from("clients").select("*").eq("workspace_id", workspaceId).eq("id", id).is("deleted_at", null).maybeSingle();

  if (error && (error.code === "42703" || error.code === "PGRST204") && error.message?.includes("deleted_at")) {
    ({ data, error } = await supabase.from("clients").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle());
  }

  if (error) throw new Error(error.message);
  if (!data) return null;
  return toClient(data as Record<string, unknown>);
}

export async function updateClient(
  { clientId, clientName, email, phone, address, notes, clientType, taxId, contactPerson, middleName, phoneNotificationsConsent, emailNotificationsConsent }: UpdateClientInput,
  workspaceId: string | undefined,
) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));

  const { data: updatedClient, error } = await supabase
    .from("clients")
    .update(
      clientRecord({
        clientName,
        email,
        phone,
        address,
        notes,
        clientType,
        taxId,
        contactPerson,
        middleName,
        phoneNotificationsConsent,
        emailNotificationsConsent,
      }),
    )
    .eq("id", clientId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .select()
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!updatedClient) throw new Error(i18n.t("clients.errors.notFoundOrForbidden"));

  return toClient(updatedClient as Record<string, unknown>);
}
