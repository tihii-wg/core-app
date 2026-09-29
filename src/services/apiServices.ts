import type { addNewServiceFormData, Service, serviceCategory } from "../lib/types";
import supabase from "./supabase";

type SupabaseError = { code?: string; message?: string };

const serviceSelect = "*";
const duplicateServiceMessage = "service with this name is already exists";

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error("No active workspace selected");
  return workspaceId;
}

function isPermissionError(error: SupabaseError) {
  return error.code === "42501" || error.message?.toLowerCase().includes("row-level security") === true;
}

function serviceError(error: SupabaseError, permissionMessage: string) {
  if (isPermissionError(error)) return new Error(permissionMessage);
  return new Error(error.message ?? permissionMessage);
}

async function assertUniqueServiceName(workspaceId: string, serviceName: string, exceptId?: string) {
  let query = supabase.from("services").select("id").eq("workspace_id", workspaceId).ilike("service_name", serviceName);
  if (exceptId) query = query.neq("id", exceptId);

  const { data, error } = await query.limit(1);
  if (error) throw new Error(error.message);
  if (data && data.length > 0) throw new Error(duplicateServiceMessage);
}

export async function createService({ serviceName, status, price, description }: addNewServiceFormData, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const name = serviceName.trim();
  await assertUniqueServiceName(targetWorkspaceId, name);

  const { data, error } = await supabase
    .from("services")
    .insert([
      {
        workspace_id: targetWorkspaceId,
        service_name: name,
        service_price: price,
        description: description || null,
        status,
      },
    ])
    .select(serviceSelect);

  if (error) throw serviceError(error, "You do not have permission to create services in this workspace.");
  if (!data || data.length === 0) throw new Error("You do not have permission to create services in this workspace.");

  return data as Service[];
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

  return (data ?? []) as Service[];
}

export async function updateService({ serviceName, status, price, description, serviceId }: addNewServiceFormData, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  if (!serviceId) throw new Error("Service was not found.");
  const name = serviceName.trim();
  await assertUniqueServiceName(targetWorkspaceId, name, serviceId);

  const { data, error } = await supabase
    .from("services")
    .update({
      service_name: name,
      service_price: price,
      description: description || null,
      status,
    })
    .eq("id", serviceId)
    .eq("workspace_id", targetWorkspaceId)
    .select(serviceSelect)
    .maybeSingle();

  const permissionMessage = "You do not have permission to edit this service.";
  if (error) throw serviceError(error, permissionMessage);
  if (!data) throw new Error(permissionMessage);

  return data as Service;
}

export async function deleteService(serviceId: string, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);

  const { data: orderServices, error: orderServicesError } = await supabase.from("order_services").select("id").eq("service_id", serviceId).limit(1);

  if (orderServicesError) throw new Error(orderServicesError.message);
  if (orderServices && orderServices.length > 0) {
    throw new Error("This service is used in orders and cannot be deleted. Set it to inactive instead.");
  }

  const { data, error } = await supabase.from("services").delete().eq("id", serviceId).eq("workspace_id", targetWorkspaceId).select("id");

  const permissionMessage = "You do not have permission to delete this service.";
  if (error) throw serviceError(error, permissionMessage);
  if (!data || data.length === 0) throw new Error(permissionMessage);

  return data;
}
