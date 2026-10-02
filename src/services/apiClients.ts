import type { Client, ClientListFilter, ClientType, CreateClientInput, UpdateClientInput } from "../lib/types";
import supabase from "./supabase";

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
  };
}

export async function createClient({ workspace_id, clientName, email, phone, address, notes, clientType, taxId, contactPerson }: CreateClientInput) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);
  if (!user) throw new Error("User is not authenticated");
  if (!workspace_id) throw new Error("No active workspace selected");

  const { data, error } = await supabase
    .from("clients")
    .insert([
      {
        workspace_id,
        ...clientRecord({ clientName, email, phone, address, notes, clientType, taxId, contactPerson }),
        added_by: user.id,
      },
    ])
    .select();

  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, unknown>[]).map(toClient);
}

function searchTerm(search: string) {
  return search.replace(/[%_,().]/g, " ").trim();
}

export async function getClients(search: string, workspaceId: string | undefined, clientType: ClientListFilter = "all") {
  if (!workspaceId) throw new Error("No active workspace selected");

  let query = supabase.from("clients").select("*").eq("workspace_id", workspaceId);

  const term = searchTerm(search);
  if (term) {
    query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,tax_id.ilike.%${term}%,contact_person.ilike.%${term}%`);
  }

  if (clientType === "individual" || clientType === "organization") {
    query = query.eq("client_type", clientType);
  }

  const { data: clients, error } = await query;

  if (error) throw new Error(error.message);

  return ((clients ?? []) as Record<string, unknown>[]).map(toClient);
}

export async function updateClient({ clientId, clientName, email, phone, address, notes, clientType, taxId, contactPerson }: UpdateClientInput, workspaceId: string | undefined) {
  if (!workspaceId) throw new Error("No active workspace selected");

  const { data: updatedClient, error } = await supabase
    .from("clients")
    .update(clientRecord({ clientName, email, phone, address, notes, clientType, taxId, contactPerson }))
    .eq("id", clientId)
    .eq("workspace_id", workspaceId)
    .select()
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!updatedClient) throw new Error("Client was not found or you do not have permission to edit it.");

  return toClient(updatedClient as Record<string, unknown>);
}
