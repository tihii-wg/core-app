import type { CreateOrderInput, OrderService } from "../lib/types";
import { createClient } from "./apiClients";
import { createService } from "./apiServices";
import supabase from "./supabase";

async function getActiveWorkspaceId() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);
  if (!user) throw new Error("User is not authenticated");

  const { data: profile, error: profileError } = await supabase.from("profiles").select("active_workspace_id").eq("id", user.id).single();

  if (profileError) throw new Error(profileError.message);
  if (!profile.active_workspace_id) throw new Error("No active workspace selected");

  return profile.active_workspace_id as string;
}

async function resolveClientId(workspaceId: string, clientId: string | undefined, clientName: string) {
  if (clientId) return clientId;

  const name = clientName.trim();
  if (!name) throw new Error("Client is required");

  const { data: existingClients, error: existingClientError } = await supabase.from("clients").select("id").eq("workspace_id", workspaceId).ilike("name", name).limit(1);

  if (existingClientError) throw new Error(existingClientError.message);
  if (existingClients?.[0]?.id) return existingClients[0].id as string;

  const createdClients = await createClient({
    workspace_id: workspaceId,
    clientName: name,
    email: "",
    phone: "",
    address: "",
    notes: "",
  });

  const createdClientId = createdClients?.[0]?.id;
  if (!createdClientId) throw new Error("Client was not created");

  return createdClientId as string;
}

async function resolveService(workspaceId: string, service: OrderService) {
  if (service.serviceId) {
    const { data: existingService, error: existingServiceError } = await supabase.from("services").select("id, service_name").eq("id", service.serviceId).eq("workspace_id", workspaceId).maybeSingle();

    if (existingServiceError) throw new Error(existingServiceError.message);
    if (existingService) {
      return { id: existingService.id as string, name: existingService.service_name as string };
    }
  }

  const { data: servicesByName, error: servicesByNameError } = await supabase
    .from("services")
    .select("id, service_name")
    .eq("workspace_id", workspaceId)
    .ilike("service_name", service.serviceName.trim())
    .limit(1);

  if (servicesByNameError) throw new Error(servicesByNameError.message);
  if (servicesByName?.[0]) {
    return { id: servicesByName[0].id as string, name: servicesByName[0].service_name as string };
  }

  const createdServices = await createService({
    serviceName: service.serviceName,
    status: "active",
    price: service.price,
  });

  const createdService = createdServices?.[0];
  if (!createdService?.id) throw new Error("Service was not created");

  return { id: createdService.id as string, name: createdService.service_name as string };
}

async function resolveAssignedEmployeeId(workspaceId: string, assignedEmployeeId?: string) {
  const selectedId = assignedEmployeeId?.trim() ?? "";
  if (!selectedId) return null;

  const { data: employee, error } = await supabase.from("employees").select("id, profile_id").eq("id", selectedId).eq("workspace_id", workspaceId).maybeSingle();

  if (error) throw new Error(error.message);
  if (!employee?.id) throw new Error("Selected employee was not found in this workspace");

  const profileId = typeof employee.profile_id === "string" ? employee.profile_id.trim() : "";
  if (!profileId) throw new Error("Selected employee is not linked to a user");

  return profileId;
}

async function nextOrderNumber(workspaceId: string) {
  const year = new Date().getFullYear();
  const prefix = `ORD-${year}-`;

  const { data: existingOrders, error } = await supabase.from("orders").select("number").eq("workspace_id", workspaceId).like("number", `${prefix}%`);

  if (error) throw new Error(error.message);

  const latest = (existingOrders ?? []).reduce((max, order) => {
    const match = String(order.number ?? "").match(new RegExp(`^${prefix}(\\d+)$`));
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);

  return `${prefix}${String(latest + 1).padStart(3, "0")}`;
}

export async function createOrder(input: CreateOrderInput) {
  const workspaceId = await getActiveWorkspaceId();
  const clientId = await resolveClientId(workspaceId, input.clientId, input.clientName);
  const assignedTo = await resolveAssignedEmployeeId(workspaceId, input.assignedEmployeeId);

  if (input.services.length === 0) throw new Error("Service is required");

  const resolvedServices = [];
  for (const service of input.services) {
    const resolved = await resolveService(workspaceId, service);
    resolvedServices.push({
      ...resolved,
      price: service.price,
      quantity: service.quantity,
    });
  }

  const totalPrice = resolvedServices.reduce((total, service) => total + service.price * service.quantity, 0);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      workspace_id: workspaceId,
      client_id: clientId,
      device: input.device.trim(),
      car_number: input.carNumber?.trim() ?? "",
      description: input.description?.trim() || null,
      assigned_to: assignedTo,
      ...(input.deadline ? { deadline: new Date(input.deadline).toISOString() } : {}),
      total_price: totalPrice,
      status: "new",
      is_paid: false,
      number: await nextOrderNumber(workspaceId),
      service_id: resolvedServices[0].id,
      service: resolvedServices.map((service) => service.name).join(", "),
    })
    .select()
    .single();

  if (orderError) throw new Error(orderError.message);

  const { error: orderServicesError } = await supabase.from("order_services").insert(
    resolvedServices.map((service) => ({
      order_id: order.id,
      service_id: service.id,
      service_name: service.name,
      price: service.price,
      quantity: service.quantity,
    }))
  );

  if (orderServicesError) throw new Error(orderServicesError.message);

  return order;
}

export async function getOrders() {
  const workspaceId = await getActiveWorkspaceId();

  const { data, error } = await supabase.from("orders").select("id, client_id, number, device, service, total_price").eq("workspace_id", workspaceId);

  if (error) throw new Error(error.message);

  return data ?? [];
}
