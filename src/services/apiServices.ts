import type { addNewServiceFormData, CatalogWarrantyType, Service, serviceCategory } from "../lib/types";
import {
  catalogWarrantyFromDbRow,
  catalogWarrantyToDbPayload,
  normalizeCatalogWarrantyDefaults,
} from "../features/orders/catalogWarranty";
import i18n from "../i18n";
import supabase from "./supabase";

type SupabaseError = { code?: string; message?: string };

const serviceSelect = "*";

let catalogWarrantyColumnsSupported: boolean | null = null;

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return workspaceId;
}

function isPermissionError(error: SupabaseError) {
  return error.code === "42501" || error.message?.toLowerCase().includes("row-level security") === true;
}

function serviceError(error: SupabaseError, permissionMessage: string) {
  if (isPermissionError(error)) return new Error(permissionMessage);
  return new Error(error.message ?? permissionMessage);
}

function isMissingCatalogWarrantyColumn(error: SupabaseError) {
  return (
    (/warranty_type|warranty_months|warranty_km/i.test(error.message ?? "") &&
      (error.code === "42703" || error.code === "PGRST204")) ||
    false
  );
}

let defaultTechnicianColumnSupported: boolean | null = null;

function isMissingDefaultTechnicianColumn(error: SupabaseError) {
  return (
    /\bdefault_technician_id\b/i.test(error.message ?? "") &&
    (error.code === "42703" || error.code === "PGRST204" || /column|schema cache/i.test(error.message ?? ""))
  );
}

function mapServiceRow(row: Record<string, unknown>): Service {
  const warranty = catalogWarrantyFromDbRow(row);
  const rawDefault = row.default_technician_id;
  const defaultTechnicianId =
    typeof rawDefault === "string" && rawDefault.trim() ? rawDefault.trim() : rawDefault === null ? null : undefined;
  return {
    id: String(row.id ?? ""),
    service_name: String(row.service_name ?? ""),
    category: String(row.category ?? ""),
    duration: typeof row.duration_minutes === "number" ? row.duration_minutes : Number(row.duration) || 0,
    service_price: typeof row.service_price === "number" ? row.service_price : Number(row.service_price) || 0,
    description: typeof row.description === "string" ? row.description : "",
    status: row.status === "inactive" ? "inactive" : "active",
    warrantyType: warranty.warrantyType,
    warrantyMonths: warranty.warrantyMonths,
    warrantyKm: warranty.warrantyKm,
    ...(defaultTechnicianId !== undefined ? { defaultTechnicianId } : {}),
  };
}

function defaultTechnicianPayload(input: Pick<addNewServiceFormData, "defaultTechnicianId">) {
  if (input.defaultTechnicianId === undefined || defaultTechnicianColumnSupported === false) return {};
  const trimmed = typeof input.defaultTechnicianId === "string" ? input.defaultTechnicianId.trim() : "";
  return { default_technician_id: trimmed || null };
}

function warrantyPayloadFromForm(input: Pick<addNewServiceFormData, "warrantyType" | "warrantyMonths" | "warrantyKm">) {
  if (input.warrantyType === undefined && input.warrantyMonths === undefined && input.warrantyKm === undefined) {
    return null;
  }
  try {
    return catalogWarrantyToDbPayload(
      normalizeCatalogWarrantyDefaults({
        warrantyType: input.warrantyType ?? "none",
        warrantyMonths: input.warrantyMonths,
        warrantyKm: input.warrantyKm,
      }),
    );
  } catch {
    throw new Error(i18n.t("catalogWarranty.errors.incomplete"));
  }
}

async function assertUniqueServiceName(workspaceId: string, serviceName: string, exceptId?: string) {
  let query = supabase.from("services").select("id").eq("workspace_id", workspaceId).ilike("service_name", serviceName);
  if (exceptId) query = query.neq("id", exceptId);

  const { data, error } = await query.limit(1);
  if (error) throw new Error(error.message);
  if (data && data.length > 0) throw new Error(i18n.t("services.errors.duplicateName"));
}

export async function createService(input: addNewServiceFormData, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const name = input.serviceName.trim();
  await assertUniqueServiceName(targetWorkspaceId, name);

  const warranty = warrantyPayloadFromForm(input);
  const base = {
    workspace_id: targetWorkspaceId,
    service_name: name,
    service_price: input.price,
    description: input.description || null,
    category: input.category || null,
    status: input.status,
    ...defaultTechnicianPayload(input),
  };

  const insertPayload =
    catalogWarrantyColumnsSupported === false || !warranty
      ? base
      : { ...base, ...warranty };

  let { data, error } = await supabase.from("services").insert([insertPayload]).select(serviceSelect);

  if (error && isMissingDefaultTechnicianColumn(error)) {
    defaultTechnicianColumnSupported = false;
    const withoutTech = { ...base };
    delete (withoutTech as { default_technician_id?: unknown }).default_technician_id;
    const retryPayload =
      catalogWarrantyColumnsSupported === false || !warranty ? withoutTech : { ...withoutTech, ...warranty };
    ({ data, error } = await supabase.from("services").insert([retryPayload]).select(serviceSelect));
  }

  if (error && warranty && isMissingCatalogWarrantyColumn(error)) {
    catalogWarrantyColumnsSupported = false;
    const withoutWarranty = { ...base };
    ({ data, error } = await supabase.from("services").insert([withoutWarranty]).select(serviceSelect));
    if (error && isMissingDefaultTechnicianColumn(error)) {
      defaultTechnicianColumnSupported = false;
      delete (withoutWarranty as { default_technician_id?: unknown }).default_technician_id;
      ({ data, error } = await supabase.from("services").insert([withoutWarranty]).select(serviceSelect));
    }
  } else if (error == null && warranty && catalogWarrantyColumnsSupported == null) {
    catalogWarrantyColumnsSupported = true;
  }
  if (error == null && input.defaultTechnicianId !== undefined && defaultTechnicianColumnSupported == null) {
    defaultTechnicianColumnSupported = true;
  }

  const permissionMessage = i18n.t("services.errors.createPermission");
  if (error) throw serviceError(error, permissionMessage);
  if (!data || data.length === 0) throw new Error(permissionMessage);

  return (data as Record<string, unknown>[]).map(mapServiceRow);
}

export async function getServices(workspaceId: string | undefined, search?: string, categoriesFilter?: serviceCategory) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);

  let query = supabase.from("services").select(serviceSelect).eq("workspace_id", targetWorkspaceId);

  if (search) {
    query = query.ilike("service_name", `%${search}%`);
  }

  if (categoriesFilter) {
    query = query.eq("category", categoriesFilter);
  }

  const { data, error } = await query;

  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, unknown>[]).map(mapServiceRow);
}

export async function updateService(input: addNewServiceFormData, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  if (!input.serviceId) throw new Error(i18n.t("services.errors.notFound"));
  const name = input.serviceName.trim();
  await assertUniqueServiceName(targetWorkspaceId, name, input.serviceId);

  const warranty = warrantyPayloadFromForm(input);
  const base = {
    service_name: name,
    service_price: input.price,
    description: input.description || null,
    category: input.category || null,
    status: input.status,
    ...defaultTechnicianPayload(input),
  };

  const updatePayload =
    catalogWarrantyColumnsSupported === false || !warranty
      ? base
      : { ...base, ...warranty };

  let { data, error } = await supabase
    .from("services")
    .update(updatePayload)
    .eq("id", input.serviceId)
    .eq("workspace_id", targetWorkspaceId)
    .select(serviceSelect)
    .maybeSingle();

  if (error && isMissingDefaultTechnicianColumn(error)) {
    defaultTechnicianColumnSupported = false;
    const withoutTech = { ...base };
    delete (withoutTech as { default_technician_id?: unknown }).default_technician_id;
    const retryPayload =
      catalogWarrantyColumnsSupported === false || !warranty ? withoutTech : { ...withoutTech, ...warranty };
    ({ data, error } = await supabase
      .from("services")
      .update(retryPayload)
      .eq("id", input.serviceId)
      .eq("workspace_id", targetWorkspaceId)
      .select(serviceSelect)
      .maybeSingle());
  }

  if (error && warranty && isMissingCatalogWarrantyColumn(error)) {
    catalogWarrantyColumnsSupported = false;
    const withoutWarranty = { ...base };
    ({ data, error } = await supabase
      .from("services")
      .update(withoutWarranty)
      .eq("id", input.serviceId)
      .eq("workspace_id", targetWorkspaceId)
      .select(serviceSelect)
      .maybeSingle());
    if (error && isMissingDefaultTechnicianColumn(error)) {
      defaultTechnicianColumnSupported = false;
      delete (withoutWarranty as { default_technician_id?: unknown }).default_technician_id;
      ({ data, error } = await supabase
        .from("services")
        .update(withoutWarranty)
        .eq("id", input.serviceId)
        .eq("workspace_id", targetWorkspaceId)
        .select(serviceSelect)
        .maybeSingle());
    }
  } else if (error == null && warranty && catalogWarrantyColumnsSupported == null) {
    catalogWarrantyColumnsSupported = true;
  }
  if (error == null && input.defaultTechnicianId !== undefined && defaultTechnicianColumnSupported == null) {
    defaultTechnicianColumnSupported = true;
  }

  const permissionMessage = i18n.t("services.errors.editPermission");
  if (error) throw serviceError(error, permissionMessage);
  if (!data) throw new Error(permissionMessage);

  return mapServiceRow(data as Record<string, unknown>);
}

export async function deleteService(serviceId: string, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);

  const { data: orderServices, error: orderServicesError } = await supabase.from("order_services").select("id").eq("service_id", serviceId).limit(1);

  if (orderServicesError) throw new Error(orderServicesError.message);
  if (orderServices && orderServices.length > 0) {
    throw new Error(i18n.t("services.errors.usedInOrders"));
  }

  const { data, error } = await supabase.from("services").delete().eq("id", serviceId).eq("workspace_id", targetWorkspaceId).select("id");

  const permissionMessage = i18n.t("services.errors.deletePermission");
  if (error) throw serviceError(error, permissionMessage);
  if (!data || data.length === 0) throw new Error(permissionMessage);

  return data;
}

/** @internal test helper */
export function __resetCatalogWarrantyColumnCacheForTests() {
  catalogWarrantyColumnsSupported = null;
}

export type { CatalogWarrantyType };
