import type { CreateOrderInput, Order, OrderService, OrderStatus, PaymentStatus, UpdateOrderDetails } from "../lib/types";
import { createClient, getClients, toClientType } from "./apiClients";
import { createService } from "./apiServices";
import supabase from "./supabase";
import { searchTerm } from "./searchTerm";

const orderPermissionMessage = "Order was not found or you do not have permission to change it.";

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error("No active workspace selected");
  return workspaceId;
}

async function resolveClientId(workspaceId: string, { clientId, clientName, clientType, clientTaxId, clientContactPerson, clientEmail = "", clientPhone = "" }: CreateOrderInput) {
  if (clientId) return clientId;

  const name = clientName.trim();
  if (!name) throw new Error("Client is required");

  const { data: existingClients, error: existingClientError } = await supabase.from("clients").select("id").eq("workspace_id", workspaceId).ilike("name", name).limit(1);

  if (existingClientError) throw new Error(existingClientError.message);
  if (existingClients?.[0]?.id) return existingClients[0].id as string;

  const createdClients = await createClient({
    workspace_id: workspaceId,
    clientName: name,
    clientType,
    taxId: clientTaxId,
    contactPerson: clientContactPerson,
    email: clientEmail,
    phone: clientPhone,
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

  const createdServices = await createService(
    {
      serviceName: service.serviceName,
      status: "active",
      price: service.price,
    },
    workspaceId,
  );

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

const defaultOrderTimeZone = "Europe/Chisinau";
const orderNumberAttempts = 5;

/** Calendar year of `timestamp` in `timeZone`; Europe/Chisinau when the zone is missing or invalid. */
export function yearInTimeZone(timestamp: string, timeZone: string | null | undefined) {
  const year = (zone: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric" }).format(new Date(timestamp)));
  try {
    return year(timeZone?.trim() || defaultOrderTimeZone);
  } catch {
    return year(defaultOrderTimeZone);
  }
}

async function workspaceTimeZone(workspaceId: string) {
  const { data, error } = await supabase.from("workspaces").select("timezone").eq("id", workspaceId).maybeSingle();

  if (error) throw new Error(error.message);
  return typeof data?.timezone === "string" ? data.timezone : null;
}

async function latestOrderSequence(workspaceId: string, prefix: string) {
  const { data: existingOrders, error } = await supabase.from("orders").select("number").eq("workspace_id", workspaceId).like("number", `${prefix}%`);

  if (error) throw new Error(error.message);

  return (existingOrders ?? []).reduce((max, order) => {
    const match = String(order.number ?? "").match(new RegExp(`^${prefix}(\\d+)$`));
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);
}

// The year comes from the created_at the database stored for this order, so the order is numbered
// after it is inserted. orders.number is unique, so a number taken in the meantime is retried.
async function assignOrderNumber(workspaceId: string, order: Record<string, unknown>, timeZone: string | null) {
  const prefix = `ORD-${yearInTimeZone(String(order.created_at), timeZone)}-`;
  let sequence = 0;

  for (let attempt = 0; attempt < orderNumberAttempts; attempt += 1) {
    sequence = Math.max(sequence, await latestOrderSequence(workspaceId, prefix)) + 1;
    const { data, error } = await supabase
      .from("orders")
      .update({ number: `${prefix}${String(sequence).padStart(3, "0")}` })
      .eq("id", order.id)
      .eq("workspace_id", workspaceId)
      .eq("number", order.number)
      .select()
      .maybeSingle();

    if (!error) {
      if (!data) throw new Error(orderPermissionMessage);
      return data as Record<string, unknown>;
    }
    if (error.code !== "23505") throw new Error(error.message);
  }

  throw new Error("Could not assign an order number. Please try again.");
}

// Not atomic: services and a new client may already exist if a later insert is rejected.
export async function createOrder(input: CreateOrderInput, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  if (input.services.length === 0) throw new Error("Service is required");

  const resolvedServices = [];
  for (const service of input.services) {
    const resolved = await resolveService(targetWorkspaceId, service);
    resolvedServices.push({
      ...resolved,
      price: service.price,
      quantity: service.quantity,
    });
  }

  const assignedTo = await resolveAssignedEmployeeId(targetWorkspaceId, input.assignedEmployeeId);
  const clientId = await resolveClientId(targetWorkspaceId, input);

  const totalPrice = resolvedServices.reduce((total, service) => total + service.price * service.quantity, 0);
  const timeZone = await workspaceTimeZone(targetWorkspaceId);

  const { data: insertedOrder, error: orderError } = await supabase
    .from("orders")
    .insert({
      workspace_id: targetWorkspaceId,
      client_id: clientId,
      device: input.device.trim(),
      car_number: input.carNumber?.trim() ?? "",
      description: input.description?.trim() || null,
      assigned_to: assignedTo,
      ...(input.deadline ? { deadline: new Date(input.deadline).toISOString() } : {}),
      total_price: totalPrice,
      status: "new",
      is_paid: false,
      number: `ORD-PENDING-${crypto.randomUUID()}`,
      ...(await vinColumnValue(input.vin)),
      service_id: resolvedServices[0].id,
      service: resolvedServices.map((service) => service.name).join(", "),
    })
    .select()
    .single();

  if (orderError) throw new Error(orderError.message);

  let order: Record<string, unknown>;
  try {
    order = await assignOrderNumber(targetWorkspaceId, insertedOrder, timeZone);
  } catch (error) {
    await supabase.from("orders").delete().eq("id", insertedOrder.id).eq("workspace_id", targetWorkspaceId);
    throw error;
  }

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

const orderStatuses = new Set<OrderStatus>(["new", "in-progress", "waiting-parts", "completed", "paid", "cancelled"]);

function formatOrderDate(value: unknown) {
  if (typeof value !== "string" || value.length < 10) return "";
  return value.slice(0, 10);
}

function clientFromRow(clients: unknown) {
  const client: Record<string, unknown> | null = Array.isArray(clients) ? clients[0] : clients && typeof clients === "object" ? (clients as Record<string, unknown>) : null;
  return {
    name: typeof client?.name === "string" ? client.name : "",
    clientType: toClientType(client?.client_type),
  };
}

type OrderServiceLine = { id?: string; order_id?: string; service_id?: string; service_name?: string; price?: number; quantity?: number };

const orderServiceColumns = "id, order_id, service_id, service_name, price, quantity";

function toOrder(row: Record<string, unknown>, employees: { id: string; name: string; profile_id: string | null }[], serviceLines: OrderServiceLine[] = []): Order {
  const assignedTo = typeof row.assigned_to === "string" ? row.assigned_to : "";
  const employee = employees.find((item) => item.profile_id === assignedTo);
  const status = orderStatuses.has(row.status as OrderStatus) ? (row.status as OrderStatus) : "new";
  const isPaid = Boolean(row.is_paid);
  const paymentStatus: PaymentStatus = isPaid ? "paid" : "unpaid";
  const client = clientFromRow(row.clients);
  const services = serviceLines.map((line) => ({
    ...(line.id ? { id: String(line.id) } : {}),
    serviceId: String(line.service_id ?? ""),
    serviceName: String(line.service_name ?? ""),
    price: Number(line.price ?? 0),
    quantity: Number(line.quantity ?? 1),
  }));

  return {
    id: String(row.id),
    workspace_id: typeof row.workspace_id === "string" ? row.workspace_id : undefined,
    clientId: typeof row.client_id === "string" ? row.client_id : "",
    clientName: client.name,
    clientType: client.clientType,
    orderNumber: typeof row.number === "string" ? row.number : "",
    device: typeof row.device === "string" ? row.device : "",
    vin: readVin(row),
    carNumber: typeof row.car_number === "string" ? row.car_number : "",
    service: typeof row.service === "string" ? row.service : services.map((service) => service.serviceName).join(", "),
    services,
    description: typeof row.description === "string" ? row.description : "",
    status,
    assignedEmployeeId: employee?.id ?? "",
    assignedEmployeeName: employee?.name ?? "",
    deadline: formatOrderDate(row.deadline),
    totalPrice: Number(row.total_price ?? 0),
    isPaid,
    paymentStatus,
    createdAt: formatOrderDate(row.created_at),
    updatedAt: formatOrderDate(row.updated_at),
  };
}

async function orderSearchFilter(workspaceId: string, term: string) {
  const vinColumn = (await supportsVinColumn()) ? "vin" : "employee_id";
  const filters = ["number", "device", "car_number", vinColumn, "service", "description"].map((column) => `${column}.ilike.%${term}%`);
  const matchingClients = await getClients(term, workspaceId);
  if (matchingClients.length > 0) filters.push(`client_id.in.(${matchingClients.map((client) => client.id).join(",")})`);
  return filters.join(",");
}

export async function getOrders(workspaceId: string | undefined, search = "") {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);

  let query = supabase.from("orders").select(orderColumns).eq("workspace_id", resolvedWorkspaceId);

  const term = searchTerm(search);
  if (term) query = query.or(await orderSearchFilter(resolvedWorkspaceId, term));

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const { data: employees, error: employeesError } = await supabase.from("employees").select("id, name, profile_id").eq("workspace_id", resolvedWorkspaceId);

  if (employeesError) throw new Error(employeesError.message);

  const rows = (data ?? []) as Record<string, unknown>[];
  const orderIds = rows.map((row) => String(row.id)).filter(Boolean);
  let serviceLines: OrderServiceLine[] = [];

  if (orderIds.length > 0) {
    const { data: lines, error: linesError } = await supabase.from("order_services").select(orderServiceColumns).in("order_id", orderIds).order("created_at", { ascending: true });

    if (linesError) throw new Error(linesError.message);
    serviceLines = lines ?? [];
  }

  return rows.map((row) =>
    toOrder(
      row,
      employees ?? [],
      serviceLines.filter((line) => line.order_id === row.id),
    ),
  );
}

export async function updateOrderStatus(orderId: string, status: OrderStatus, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);

  const { data, error } = await supabase
    .from("orders")
    .update(status === "paid" ? { status, is_paid: true } : { status })
    .eq("id", orderId)
    .eq("workspace_id", targetWorkspaceId)
    .select("id");

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error(orderPermissionMessage);
}

const orderColumns = "*,clients(name,client_type)";

let vinColumnSupported: boolean | undefined;

async function supportsVinColumn() {
  if (vinColumnSupported !== undefined) return vinColumnSupported;

  const { error } = await supabase.from("orders").select("vin").limit(1);
  vinColumnSupported = !error;

  return vinColumnSupported;
}

export function readVin(row: Record<string, unknown>) {
  if (typeof row.vin === "string" && row.vin) return row.vin;
  if (typeof row.employee_id === "string" && /^[A-Za-z0-9]{17}$/.test(row.employee_id)) return row.employee_id.toUpperCase();
  return "";
}

async function vinColumnValue(vin: string | undefined) {
  const normalizedVin = vin?.trim().toUpperCase() ?? "";
  if (!normalizedVin) return {};
  if (await supportsVinColumn()) return { vin: normalizedVin };
  return { employee_id: normalizedVin };
}

export async function updateOrder({ orderId, device, carNumber, vin = "", description, assignedEmployeeId, deadline, services }: UpdateOrderDetails, targetWorkspaceId: string | undefined) {
  const workspaceId = requireWorkspaceId(targetWorkspaceId);
  if (services && services.length === 0) throw new Error("Service is required");
  const assignedTo = await resolveAssignedEmployeeId(workspaceId, assignedEmployeeId);
  const normalizedVin = vin.trim().toUpperCase();

  if (normalizedVin && normalizedVin.length !== 17) throw new Error("VIN must contain exactly 17 characters");

  const { data, error } = await supabase
    .from("orders")
    .update({
      device: device.trim(),
      car_number: carNumber.trim().toUpperCase(),
      description: description.trim() || null,
      assigned_to: assignedTo,
      deadline: deadline ? `${deadline}T00:00:00.000Z` : null,
      ...(await vinColumnValue(normalizedVin)),
    })
    .eq("id", orderId)
    .eq("workspace_id", workspaceId)
    .select(orderColumns)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(orderPermissionMessage);

  const { lines, summary } = services ? await syncOrderServices(workspaceId, orderId, services) : { lines: [], summary: null };
  const { data: employees, error: employeesError } = await supabase.from("employees").select("id, name, profile_id").eq("workspace_id", workspaceId);

  if (employeesError) throw new Error(employeesError.message);

  const order = toOrder({ ...(data as Record<string, unknown>), ...summary, ...(normalizedVin ? { vin: normalizedVin } : {}) }, employees ?? [], lines);

  return order;
}

function isSameService(line: OrderServiceLine, service: OrderService) {
  return line.service_id === service.serviceId || String(line.service_name ?? "").toLowerCase() === service.serviceName.trim().toLowerCase();
}

// Makes the order's lines exactly match `services`: saved lines are matched by id, removed ones are
// deleted (the global service stays), unsaved ones are inserted once. Not atomic: new lines are
// inserted before removed ones are deleted, and saving the same form again converges.
async function syncOrderServices(workspaceId: string, orderId: string, services: OrderService[]) {
  const { data: existingLines, error: existingLinesError } = await supabase.from("order_services").select(orderServiceColumns).eq("order_id", orderId).order("created_at", { ascending: true });

  if (existingLinesError) throw new Error(existingLinesError.message);

  const unclaimed: OrderServiceLine[] = [...(existingLines ?? [])];
  const kept: OrderServiceLine[] = [];
  const unsaved: OrderService[] = [];

  for (const service of services) {
    const index = service.id ? unclaimed.findIndex((line) => line.id === service.id) : -1;
    if (index >= 0) kept.push(...unclaimed.splice(index, 1));
    else unsaved.push(service);
  }

  const newLines: { order_id: string; service_id: string; service_name: string; price: number; quantity: number }[] = [];

  for (const service of unsaved) {
    if (!service.serviceName.trim()) continue;

    const identical = unclaimed.findIndex((line) => isSameService(line, service) && Number(line.price) === service.price && Number(line.quantity) === service.quantity);
    if (identical >= 0) {
      kept.push(...unclaimed.splice(identical, 1));
      continue;
    }
    if ([...kept, ...newLines].some((line) => isSameService(line, service))) continue;

    const resolved = await resolveService(workspaceId, service);
    if ([...kept, ...newLines].some((line) => line.service_id === resolved.id)) continue;

    newLines.push({
      order_id: orderId,
      service_id: resolved.id,
      service_name: resolved.name,
      price: service.price,
      quantity: service.quantity,
    });
  }

  const removedIds = unclaimed.map((line) => String(line.id));
  let inserted: OrderServiceLine[] = [];

  if (newLines.length > 0) {
    const { data: insertedLines, error: insertError } = await supabase.from("order_services").insert(newLines).select(orderServiceColumns);
    if (insertError) throw new Error(insertError.message);
    inserted = insertedLines ?? [];
  }

  if (removedIds.length > 0) {
    const { data: deletedLines, error: deleteError } = await supabase.from("order_services").delete().eq("order_id", orderId).in("id", removedIds).select("id");
    if (deleteError) throw new Error(deleteError.message);
    if (!deletedLines || deletedLines.length !== removedIds.length) throw new Error(orderPermissionMessage);
  }

  const lines = [...kept, ...inserted];
  if (newLines.length === 0 && removedIds.length === 0) return { lines, summary: null };

  const summary = {
    service: lines.map((line) => String(line.service_name ?? "")).join(", "),
    service_id: lines[0]?.service_id ?? null,
    total_price: lines.reduce((total, line) => total + Number(line.price ?? 0) * Number(line.quantity ?? 1), 0),
  };

  const { data: updatedRows, error: summaryError } = await supabase.from("orders").update(summary).eq("id", orderId).eq("workspace_id", workspaceId).select("id");

  if (summaryError) throw new Error(summaryError.message);
  if (!updatedRows || updatedRows.length === 0) throw new Error(orderPermissionMessage);

  return { lines, summary };
}
