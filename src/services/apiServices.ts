import type { addNewServiceFormData, serviceCategory } from "../lib/types";
import supabase from "./supabase";

export async function createService({ serviceName, status, price, description }: addNewServiceFormData) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);
  if (!user) throw new Error("User is not authenticated");

  const { data: profile, error: profileError } = await supabase.from("profiles").select("active_workspace_id").eq("id", user.id).single();

  if (profileError) throw new Error(profileError.message);
  if (!profile.active_workspace_id) throw new Error("No active workspace selected");

  const { data: existingService, error: existingServiceError } = await supabase
    .from("services")
    .select("id")
    .eq("workspace_id", profile.active_workspace_id)
    .ilike("service_name", serviceName.trim())
    .maybeSingle();

  if (existingServiceError) {
    throw new Error(existingServiceError.message);
  }
  if (existingService) throw new Error("service with this name is already exists");

  const { data, error } = await supabase
    .from("services")
    .insert([
      {
        workspace_id: profile.active_workspace_id,
        service_name: serviceName.trim(),
        service_price: price,
        description: description || null,
        status: status,
      },
    ])
    .select();

  if (error) throw new Error(error.message);

  return data;
}

export async function getServices(search?: string, categoriesFilter?: serviceCategory) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("User not found");

  const { data: profile, error: profileError } = await supabase.from("profiles").select("active_workspace_id").eq("id", user.id).single();

  if (profileError) throw new Error(profileError.message);

  if (!profile.active_workspace_id) throw new Error("No active  workspace selected");

  let query = supabase.from("services").select("*").eq("workspace_id", profile.active_workspace_id);

  if (search) {
    query = query.ilike("service_name", `%${search}%`);
  }

  if (categoriesFilter) {
    query = query.eq("category", categoriesFilter);
  }

  const { data: services, error } = await query;

  if (error) throw new Error(error.message);

  return services;
}

export async function updateService({ serviceName, status, price, description, serviceId }: addNewServiceFormData) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);
  if (!user) throw new Error("User is not authenticated");

  const { data: profile, error: profileError } = await supabase.from("profiles").select("active_workspace_id").eq("id", user.id).single();

  if (profileError) throw new Error(profileError.message);
  if (!profile.active_workspace_id) throw new Error("No active workspace selected");

  const { data: existingService, error: existingServiceError } = await supabase
    .from("services")
    .select("id")
    .eq("workspace_id", profile.active_workspace_id)
    .ilike("service_name", serviceName.trim())
    .neq("id", serviceId)
    .maybeSingle();

  if (existingServiceError) {
    throw new Error(existingServiceError.message);
  }
  if (existingService) throw new Error("service with this name is already exists");

  const { data: updatedService, error } = await supabase
    .from("services")
    .update({
      service_name: serviceName.trim(),
      service_price: price,
      description: description || null,
      status,
    })
    .eq("id", serviceId)
    .eq("workspace_id", profile.active_workspace_id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  return updatedService;
}

export async function deleteService(serviceId: string) {
	console.log(serviceId)
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);
  if (!user) throw new Error("User is not authenticated");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("active_workspace_id")
    .eq("id", user.id)
    .single();

  if (profileError) throw new Error(profileError.message);

  if (!profile.active_workspace_id) {
    throw new Error("No active workspace selected");
  }

  // Проверяем, используется ли услуга в заказах
  const { data: orderServices, error: orderServicesError } =
    await supabase
      .from("order_services")
      .select("id")
      .eq("service_id", serviceId)
      .limit(1);

  if (orderServicesError) {
    throw new Error(orderServicesError.message);
  }

  if (orderServices && orderServices.length > 0) {
    throw new Error(
      "This service is used in orders and cannot be deleted. Set it to inactive instead."
    );
  }
	const { data: service, error: serviceError } = await supabase
  .from("services")
  .select("id, workspace_id, service_name")
  .eq("id", serviceId)
  .single();

console.log("SERVICE BEFORE DELETE:", service);
console.log("SERVICE ERROR:", serviceError);
	console.log("CURRENT WORKSPACE:", profile.active_workspace_id);
	

  // Удаляем услугу только из текущего workspace
  const { data: deletedService, error: deleteError } = await supabase
  .from("services")
  .delete()
  .eq("id", serviceId)
  .eq("workspace_id", profile.active_workspace_id)
  // .select()
  // .single();

if (deleteError) {
  console.error("DELETE ERROR:", deleteError);
  throw new Error(deleteError.message);
}

console.log("DELETED:", deletedService);

return deletedService;
}
