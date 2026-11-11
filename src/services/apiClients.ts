import type { Client, ClientListFilter, ClientType, CreateClientInput, UpdateClientInput } from "../lib/types";
import i18n from "../i18n";
import { plateLoosePatterns, plateMatchesQuery } from "../lib/plateVin";
import { MIN_PHONE_SEARCH_DIGITS, phoneDigits, phoneSearchVariants } from "../lib/phoneSearch";
import { vehicleMakeModelMatches } from "../lib/vehicleTextSearch";
import supabase from "./supabase";
import { searchTerm } from "./searchTerm";

/**
 * Page size for vehicle candidate scans during Clients search.
 * Filtering runs in Supabase (`workspace_id`, `deleted_at`, OR make/model/plate/VIN);
 * pages are fetched until exhausted so matches beyond any single page are not dropped.
 * Client-side `vehicleRowMatchesSearch` then applies plate/VIN normalization and
 * multi-token make/model AND semantics on each complete page.
 */
export const CLIENT_VEHICLE_SEARCH_PAGE_SIZE = 500;

/** Field `or` filter for clients list search, including digit-normalized phone variants. */
function clientFieldSearchOrFilter(term: string): string {
  const parts = [
    `name.ilike.%${term}%`,
    `email.ilike.%${term}%`,
    `phone.ilike.%${term}%`,
    `tax_id.ilike.%${term}%`,
    `contact_person.ilike.%${term}%`,
    `address.ilike.%${term}%`,
  ];
  const digits = phoneDigits(term);
  if (digits.length >= MIN_PHONE_SEARCH_DIGITS) {
    for (const variant of phoneSearchVariants(digits)) {
      // Variants are digits-only; strip PostgREST-sensitive chars defensively.
      const safe = variant.replace(/[%_,().]/g, "");
      if (safe.length >= MIN_PHONE_SEARCH_DIGITS) {
        parts.push(`phone.ilike.%${safe}%`);
      }
    }
  }
  return parts.join(",");
}

function vehicleSearchOrFilter(term: string): string {
  const parts = [
    `license_plate.ilike.%${term}%`,
    `vin.ilike.%${term}%`,
    `make.ilike.%${term}%`,
    `model.ilike.%${term}%`,
  ];
  // Latin-mapped and as-typed (Cyrillic) loose patterns, so "ТАК 123" finds "ТАК123".
  for (const loose of plateLoosePatterns(term)) {
    parts.push(`license_plate.ilike.${loose}`);
  }
  for (const token of term.split(/\s+/)) {
    const safe = searchTerm(token);
    if (safe.length < 2) continue;
    parts.push(`make.ilike.%${safe}%`, `model.ilike.%${safe}%`);
  }
  return parts.join(",");
}

function vehicleRowMatchesSearch(
  row: { make?: unknown; model?: unknown; license_plate?: unknown; vin?: unknown },
  rawSearch: string,
  term: string,
): boolean {
  const plate = typeof row.license_plate === "string" ? row.license_plate : "";
  const vin = typeof row.vin === "string" ? row.vin : "";
  const make = typeof row.make === "string" ? row.make : null;
  const model = typeof row.model === "string" ? row.model : null;
  if (plate && plateMatchesQuery(plate, rawSearch)) return true;
  if (vin && plateMatchesQuery(vin, rawSearch)) return true;
  if (vehicleMakeModelMatches(make, model, term)) return true;
  return false;
}

type VehicleSearchRow = {
  client_id?: unknown;
  make?: unknown;
  model?: unknown;
  license_plate?: unknown;
  vin?: unknown;
};

/**
 * Collect distinct client IDs whose vehicles match the search within the workspace.
 * Paginates the Supabase OR-filtered vehicle query until every matching page is read —
 * no fixed row ceiling that can silently drop later matches.
 */
export async function collectVehicleMatchedClientIds(
  workspaceId: string,
  rawSearch: string,
  term: string,
  { pageSize = CLIENT_VEHICLE_SEARCH_PAGE_SIZE }: { pageSize?: number } = {},
): Promise<{ clientIds: string[]; error: { code?: string; message: string } | null }> {
  const safePageSize = Math.max(1, Math.min(1000, Math.floor(pageSize) || CLIENT_VEHICLE_SEARCH_PAGE_SIZE));
  const orFilter = vehicleSearchOrFilter(term);
  const clientIds = new Set<string>();
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("vehicles")
      .select("client_id, make, model, license_plate, vin")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .or(orFilter)
      .order("id", { ascending: true })
      .range(offset, offset + safePageSize - 1);

    if (error) {
      return { clientIds: [...clientIds], error: { code: error.code, message: error.message } };
    }

    const rows = (data ?? []) as VehicleSearchRow[];
    for (const row of rows) {
      if (!vehicleRowMatchesSearch(row, rawSearch, term)) continue;
      const id = typeof row.client_id === "string" ? row.client_id.trim() : "";
      if (id) clientIds.add(id);
    }

    if (rows.length < safePageSize) break;
    offset += safePageSize;
  }

  return { clientIds: [...clientIds], error: null };
}

const CLIENT_IN_CHUNK = 200;

async function fetchClientsByIds(
  workspaceId: string,
  clientIds: string[],
  clientType: ClientListFilter,
): Promise<Client[]> {
  if (clientIds.length === 0) return [];

  const out: Client[] = [];
  for (let i = 0; i < clientIds.length; i += CLIENT_IN_CHUNK) {
    const chunk = clientIds.slice(i, i + CLIENT_IN_CHUNK);
    let vehicleClientsQuery = supabase
      .from("clients")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .in("id", chunk);

    if (clientType === "individual" || clientType === "organization") {
      vehicleClientsQuery = vehicleClientsQuery.eq("client_type", clientType);
    }

    const { data: vehicleClients, error: vehicleClientsError } = await vehicleClientsQuery;
    if (vehicleClientsError) throw new Error(vehicleClientsError.message);
    for (const row of (vehicleClients ?? []) as Record<string, unknown>[]) {
      out.push(toClient(row));
    }
  }
  return out;
}

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

/** Writable client fields for create/update. Email is intentionally omitted so existing values are never cleared. */
function clientRecord(input: {
  clientName: string;
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

export async function getClients(
  search: string,
  workspaceId: string | undefined,
  clientType: ClientListFilter = "all",
  { includeVehicleMatches = true }: { includeVehicleMatches?: boolean } = {},
) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));

  let query = supabase.from("clients").select("*").eq("workspace_id", workspaceId).is("deleted_at", null);

  const term = searchTerm(search);
  if (term) {
    query = query.or(clientFieldSearchOrFilter(term));
  }

  if (clientType === "individual" || clientType === "organization") {
    query = query.eq("client_type", clientType);
  }

  let { data: clients, error } = await query;

  // Before the General Settings SQL is applied, deleted_at may not exist yet.
  if (error && (error.code === "42703" || error.code === "PGRST204") && error.message?.includes("deleted_at")) {
    let fallback = supabase.from("clients").select("*").eq("workspace_id", workspaceId);
    if (term) {
      fallback = fallback.or(clientFieldSearchOrFilter(term));
    }
    if (clientType === "individual" || clientType === "organization") {
      fallback = fallback.eq("client_type", clientType);
    }
    ({ data: clients, error } = await fallback);
  }

  if (error) throw new Error(error.message);

  const byFields = ((clients ?? []) as Record<string, unknown>[]).map(toClient);

  // Also match clients via vehicles: plate/VIN (normalized) and make/model.
  // Order create form disables this when it shows explicit vehicle+client plate hits instead.
  if (!term || !includeVehicleMatches) return byFields;

  const { clientIds: matchedVehicleClientIds, error: vehicleError } = await collectVehicleMatchedClientIds(
    workspaceId,
    search,
    term,
  );

  if (vehicleError) {
    // vehicles table / columns may be missing in older DBs — keep field matches only.
    if (vehicleError.code === "42P01" || vehicleError.code === "42703" || vehicleError.code === "PGRST204") {
      return byFields;
    }
    throw new Error(vehicleError.message);
  }

  const seen = new Set(byFields.map((client) => client.id));
  const vehicleClientIds = matchedVehicleClientIds.filter((id) => id && !seen.has(id));
  if (vehicleClientIds.length === 0) return byFields;

  const extras = (await fetchClientsByIds(workspaceId, vehicleClientIds, clientType)).filter(
    (client) => !seen.has(client.id),
  );

  return [...byFields, ...extras];
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
  if (data) return toClient(data as Record<string, unknown>);

  // Soft-deleted + merged: redirect to the survivor instead of "not found".
  const merged = await getMergedRedirectClient(workspaceId, id);
  return merged;
}

/** When a client was merged away, follow `merged_into_client_id` to the survivor. */
async function getMergedRedirectClient(workspaceId: string, clientId: string) {
  const { data, error } = await supabase
    .from("clients")
    .select("merged_into_client_id")
    .eq("workspace_id", workspaceId)
    .eq("id", clientId)
    .not("deleted_at", "is", null)
    .not("merged_into_client_id", "is", null)
    .maybeSingle();

  if (error) {
    // Column may be missing before the merge SQL is applied.
    if (error.code === "42703" || error.code === "PGRST204") return null;
    throw new Error(error.message);
  }
  const targetId = typeof data?.merged_into_client_id === "string" ? data.merged_into_client_id.trim() : "";
  if (!targetId || targetId === clientId) return null;

  const { data: survivor, error: survivorError } = await supabase
    .from("clients")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", targetId)
    .is("deleted_at", null)
    .maybeSingle();

  if (survivorError) throw new Error(survivorError.message);
  if (!survivor) return null;
  return toClient(survivor as Record<string, unknown>);
}

export type MergeClientsPreview = {
  orders: number;
  vehicles: number;
  invoices: number;
  payments: number;
  ordersOpen: number;
  ordersClosed: number;
  counts: Record<string, number>;
  sourceNotes: Array<{ id: string; name: string; phone: string | null; email: string | null }>;
};

function mapMergeClientsError(message: string): string {
  if (/merge_clients:forbidden/i.test(message)) return i18n.t("clients.merge.errors.forbidden");
  if (/merge_clients:name_required/i.test(message)) return i18n.t("clients.merge.errors.nameRequired");
  if (/merge_clients:sources_required/i.test(message)) return i18n.t("clients.merge.errors.sourcesRequired");
  if (/merge_clients:target_not_found|merge_clients:source_not_found/i.test(message)) {
    return i18n.t("clients.merge.errors.notFound");
  }
  if (/merge_clients:unhandled_unique/i.test(message)) return i18n.t("clients.merge.errors.unhandledUnique");
  if (/Could not find the function|PGRST202|42883/i.test(message)) {
    return i18n.t("clients.merge.errors.rpcMissing");
  }
  return message || i18n.t("common.somethingWentWrong");
}

export async function mergeClientsPreview(
  workspaceId: string | undefined,
  targetClientId: string,
  sourceClientIds: string[],
): Promise<MergeClientsPreview> {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  const { data, error } = await supabase.rpc("crm_merge_clients_preview", {
    p_workspace_id: workspaceId,
    p_target_client_id: targetClientId,
    p_source_client_ids: sourceClientIds,
  });
  if (error) throw new Error(mapMergeClientsError(error.message ?? ""));
  const row = (data ?? {}) as Record<string, unknown>;
  const counts =
    row.counts && typeof row.counts === "object" && !Array.isArray(row.counts)
      ? (row.counts as Record<string, number>)
      : {};
  const sourceNotes = Array.isArray(row.sourceNotes)
    ? (row.sourceNotes as Array<Record<string, unknown>>).map((entry) => ({
        id: String(entry.id ?? ""),
        name: String(entry.name ?? ""),
        phone: typeof entry.phone === "string" ? entry.phone : null,
        email: typeof entry.email === "string" ? entry.email : null,
      }))
    : [];
  return {
    orders: Number(row.orders ?? 0),
    vehicles: Number(row.vehicles ?? 0),
    invoices: Number(row.invoices ?? 0),
    payments: Number(row.payments ?? 0),
    ordersOpen: Number(row.ordersOpen ?? 0),
    ordersClosed: Number(row.ordersClosed ?? 0),
    counts,
    sourceNotes,
  };
}

export async function mergeClients(
  workspaceId: string | undefined,
  targetClientId: string,
  sourceClientIds: string[],
  newName: string,
): Promise<string> {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  const { data, error } = await supabase.rpc("crm_merge_clients", {
    p_workspace_id: workspaceId,
    p_target_client_id: targetClientId,
    p_source_client_ids: sourceClientIds,
    p_new_name: newName,
  });
  if (error) throw new Error(mapMergeClientsError(error.message ?? ""));
  const id = typeof data === "string" ? data : String(data ?? "");
  if (!id) throw new Error(i18n.t("clients.merge.errors.failed"));
  return id;
}

export async function updateClient(
  { clientId, clientName, phone, address, notes, clientType, taxId, contactPerson, middleName, phoneNotificationsConsent, emailNotificationsConsent }: UpdateClientInput,
  workspaceId: string | undefined,
) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));

  const { data: updatedClient, error } = await supabase
    .from("clients")
    .update(
      clientRecord({
        clientName,
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

/**
 * Soft-deletes a client (`deleted_at`). Historical orders/invoices stay intact —
 * hard DELETE is unsafe because `orders.client_id` is ON DELETE CASCADE.
 * Soft-deleted clients are already excluded from lists and new-order pickers.
 */
export async function softDeleteClient(workspaceId: string | undefined, clientId: string) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  const id = clientId.trim();
  if (!id) throw new Error(i18n.t("clients.errors.notFoundOrForbidden"));

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("clients")
    .update({ deleted_at: now, updated_at: now })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    if ((error.code === "42703" || error.code === "PGRST204") && error.message?.includes("deleted_at")) {
      throw new Error(i18n.t("clients.errors.deleteRequiresDeletedAt"));
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error(i18n.t("clients.errors.notFoundOrForbidden"));
  return { id };
}
