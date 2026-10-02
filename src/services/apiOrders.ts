import type { CreateOrderInput, Order, OrderService, OrderStatus, PaymentStatus, UpdateOrderDetails } from "../lib/types";
import { createClient } from "./apiClients";
import { createService } from "./apiServices";
import supabase from "./supabase";

const orderPermissionMessage = "Order was not found or you do not have permission to change it.";

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error("No active workspace selected");
  return workspaceId;
}

async function resolveClientId(workspaceId: string, { clientId, clientName, clientEmail = "", clientPhone = "" }: CreateOrderInput) {
  if (clientId) return clientId;

  const name = clientName.trim();
  if (!name) throw new Error("Client is required");

  const { data: existingClients, error: existingClientError } = await supabase.from("clients").select("id").eq("workspace_id", workspaceId).ilike("name", name).limit(1);

  if (existingClientError) throw new Error(existingClientError.message);
  if (existingClients?.[0]?.id) return existingClients[0].id as string;

  const createdClients = await createClient({
    workspace_id: workspaceId,
    clientName: name,
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

  const { data: order, error: orderError } = await supabase
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
      number: await nextOrderNumber(targetWorkspaceId),
      ...(await vinColumnValue(input.vin)),
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

const orderStatuses = new Set<OrderStatus>(["new", "in-progress", "waiting-parts", "completed", "paid", "cancelled"]);

function formatOrderDate(value: unknown) {
  if (typeof value !== "string" || value.length < 10) return "";
  return value.slice(0, 10);
}

function clientNameFromRow(clients: unknown) {
  const client = Array.isArray(clients) ? clients[0] : clients;
  if (client && typeof client === "object" && "name" in client && typeof client.name === "string") return client.name;
  return "";
}

function toOrder(
  row: Record<string, unknown>,
  employees: { id: string; name: string; profile_id: string | null }[],
  serviceLines: { service_id?: string; service_name?: string; price?: number; quantity?: number }[] = [],
): Order {
  const assignedTo = typeof row.assigned_to === "string" ? row.assigned_to : "";
  const employee = employees.find((item) => item.profile_id === assignedTo);
  const status = orderStatuses.has(row.status as OrderStatus) ? (row.status as OrderStatus) : "new";
  const isPaid = Boolean(row.is_paid);
  const paymentStatus: PaymentStatus = isPaid ? "paid" : "unpaid";
  const services = serviceLines.map((line) => ({
    serviceId: String(line.service_id ?? ""),
    serviceName: String(line.service_name ?? ""),
    price: Number(line.price ?? 0),
    quantity: Number(line.quantity ?? 1),
  }));

  return {
    id: String(row.id),
    workspace_id: typeof row.workspace_id === "string" ? row.workspace_id : undefined,
    clientId: typeof row.client_id === "string" ? row.client_id : "",
    clientName: clientNameFromRow(row.clients),
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

export async function getOrders(workspaceId: string | undefined) {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);

  const { data, error } = await supabase
    .from("orders")
    .select(orderColumns)
    .eq("workspace_id", resolvedWorkspaceId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const { data: employees, error: employeesError } = await supabase.from("employees").select("id, name, profile_id").eq("workspace_id", resolvedWorkspaceId);

  if (employeesError) throw new Error(employeesError.message);

  const rows = (data ?? []) as Record<string, unknown>[];
  const orderIds = rows.map((row) => String(row.id)).filter(Boolean);
  let serviceLines: { order_id?: string; service_id?: string; service_name?: string; price?: number; quantity?: number }[] = [];

  if (orderIds.length > 0) {
    const { data: lines, error: linesError } = await supabase.from("order_services").select("order_id, service_id, service_name, price, quantity").in("order_id", orderIds);

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

const orderColumns = "*,clients(name)";

let vinColumnSupported: boolean | undefined;

async function supportsVinColumn() {
  if (vinColumnSupported !== undefined) return vinColumnSupported;

  const { error } = await supabase.from("orders").select("vin").limit(1);
  vinColumnSupported = !error;

  return vinColumnSupported;
}

function readVin(row: Record<string, unknown>) {
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

export async function updateOrder({ orderId, device, carNumber, vin = "", description, assignedEmployeeId, deadline, services = [] }: UpdateOrderDetails, targetWorkspaceId: string | undefined) {
  const workspaceId = requireWorkspaceId(targetWorkspaceId);
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

  const { lines: addedServices, summary } = services.length > 0 ? await appendOrderServices(workspaceId, orderId, services) : { lines: [], summary: null };
  const { data: employees, error: employeesError } = await supabase.from("employees").select("id, name, profile_id").eq("workspace_id", workspaceId);

  if (employeesError) throw new Error(employeesError.message);

  const order = toOrder({ ...(data as Record<string, unknown>), ...summary, ...(normalizedVin ? { vin: normalizedVin } : {}) }, employees ?? [], addedServices);

  return order;
}

async function appendOrderServices(workspaceId: string, orderId: string, services: OrderService[]) {
  const { data: existingLines, error: existingLinesError } = await supabase.from("order_services").select("service_id, service_name, price, quantity").eq("order_id", orderId);

  if (existingLinesError) throw new Error(existingLinesError.message);

  const lines = existingLines ?? [];
  const existingIds = new Set(lines.map((line) => line.service_id));
  const existingNames = new Set(lines.map((line) => String(line.service_name ?? "").toLowerCase()));
  const newLines = [];

  for (const service of services) {
    const name = service.serviceName.trim();
    if (!name || existingIds.has(service.serviceId) || existingNames.has(name.toLowerCase())) continue;

    const resolved = await resolveService(workspaceId, service);
    newLines.push({
      order_id: orderId,
      service_id: resolved.id,
      service_name: resolved.name,
      price: service.price,
      quantity: service.quantity,
    });
    existingIds.add(resolved.id);
    existingNames.add(resolved.name.toLowerCase());
  }

  if (newLines.length === 0) {
    return {
      summary: null,
      lines: lines.map((line) => ({
        service_id: line.service_id as string,
        service_name: line.service_name as string,
        price: Number(line.price ?? 0),
        quantity: Number(line.quantity ?? 1),
      })),
    };
  }

  const { error: insertError } = await supabase.from("order_services").insert(newLines);
  if (insertError) throw new Error(insertError.message);

  const allLines = [
    ...lines.map((line) => ({
      service_name: String(line.service_name ?? ""),
      price: Number(line.price ?? 0),
      quantity: Number(line.quantity ?? 1),
    })),
    ...newLines.map((line) => ({
      service_name: line.service_name,
      price: line.price,
      quantity: line.quantity,
    })),
  ];
  const summary = {
    service: allLines.map((line) => line.service_name).join(", "),
    total_price: allLines.reduce((total, line) => total + line.price * line.quantity, 0),
  };

  const { data: updatedRows, error: summaryError } = await supabase.from("orders").update(summary).eq("id", orderId).eq("workspace_id", workspaceId).select("id");

  if (summaryError) throw new Error(summaryError.message);
  if (!updatedRows || updatedRows.length === 0) throw new Error(orderPermissionMessage);

  return {
    summary,
    lines: [
      ...lines.map((line) => ({
        service_id: line.service_id as string,
        service_name: line.service_name as string,
        price: Number(line.price ?? 0),
        quantity: Number(line.quantity ?? 1),
      })),
      ...newLines.map((line) => ({
        service_id: line.service_id,
        service_name: line.service_name,
        price: line.price,
        quantity: line.quantity,
      })),
    ],
  };
}
