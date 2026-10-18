import type { CreateOrderInput, Order, OrderMaterial, OrderService, OrderStatus, PaymentStatus, UpdateOrderDetails } from "../lib/types";
import { consolidateOrderMaterials } from "../features/inventory/orderMaterialLine";
import { createClient, getClients, toClientType } from "./apiClients";
import { createService } from "./apiServices";
import supabase from "./supabase";
import { searchTerm } from "./searchTerm";
import i18n from "../i18n";

const orderPermissionMessage = () => i18n.t("orders.errors.notFoundOrForbidden");

function materialsSyncError(error: { message?: string; code?: string } | null) {
  const message = error?.message ?? "";
  const code = error?.code ?? "";
  // Missing live RPC (PGRST202) or similar — never treat as a successful materials save.
  if (code === "PGRST202" || /could not find the function|function .* does not exist/i.test(message)) {
    return i18n.t("orders.errors.materialsSyncFailed");
  }
  if (message.includes("outstanding issued") || message.includes("already issued")) {
    return i18n.t("orders.errors.cannotReduceBelowIssued");
  }
  if (message.includes("unavailable") || message.includes("Inventory item")) {
    return i18n.t("orders.errors.invalidMaterial");
  }
  return message || i18n.t("orders.errors.materialsSyncFailed");
}

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return workspaceId;
}

async function resolveClientId(workspaceId: string, { clientId, clientName, clientType, clientTaxId, clientContactPerson, clientEmail = "", clientPhone = "" }: CreateOrderInput) {
  if (clientId) return clientId;

  const name = clientName.trim();
  if (!name) throw new Error(i18n.t("orders.validation.clientRequired"));

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
  if (!createdClientId) throw new Error(i18n.t("orders.errors.clientNotCreated"));

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
  if (!createdService?.id) throw new Error(i18n.t("orders.errors.serviceNotCreated"));

  return { id: createdService.id as string, name: createdService.service_name as string };
}

/**
 * Resolve a form assignee to employees.id for orders.employee_id.
 * Employees belong to a workspace via workspace_id only — profile_id / Auth is optional.
 * Legacy form values that still hold an auth user id (from old assigned_to) are remapped to employees.id.
 */
async function resolveAssignedEmployeeId(workspaceId: string, assignedEmployeeId?: string) {
  const selectedId = assignedEmployeeId?.trim() ?? "";
  if (!selectedId) return null;

  const { data: byId, error: byIdError } = await supabase
    .from("employees")
    .select("id")
    .eq("id", selectedId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (byIdError) throw new Error(byIdError.message);
  if (byId?.id) return String(byId.id);

  // Legacy edit values may still pass an auth user id previously stored on assigned_to.
  const { data: byProfile, error: byProfileError } = await supabase
    .from("employees")
    .select("id")
    .eq("profile_id", selectedId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (byProfileError) throw new Error(byProfileError.message);
  if (!byProfile?.id) throw new Error(i18n.t("orders.errors.employeeNotFound"));
  return String(byProfile.id);
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
      if (!data) throw new Error(orderPermissionMessage());
      return data as Record<string, unknown>;
    }
    if (error.code !== "23505") throw new Error(error.message);
  }

  throw new Error(i18n.t("orders.errors.orderNumberFailed"));
}

// Not atomic across client/service creation, order insert, and materials RPC.
// Empty materials skip the sync RPC (avoids failing create when sync_order_materials is unavailable).
// Non-empty materials require the RPC; on failure the order is deleted (CASCADE service lines).
// Clients/services created earlier in this call are not rolled back.
export async function createOrder(input: CreateOrderInput, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  if (input.services.length === 0) throw new Error(i18n.t("orders.validation.serviceRequired"));

  const resolvedServices = [];
  for (const service of input.services) {
    const resolved = await resolveService(targetWorkspaceId, service);
    resolvedServices.push({
      ...resolved,
      price: service.price,
      quantity: service.quantity,
    });
  }

  const employeeId = await resolveAssignedEmployeeId(targetWorkspaceId, input.assignedEmployeeId);
  const clientId = await resolveClientId(targetWorkspaceId, input);
  const materials = consolidateOrderMaterials(input.materials ?? []);

  const serviceTotal = resolvedServices.reduce((total, service) => total + service.price * service.quantity, 0);
  const materialTotal = materials.reduce((total, line) => total + line.price * line.quantity, 0);
  const timeZone = await workspaceTimeZone(targetWorkspaceId);
  const normalizedVin = input.vin?.trim().toUpperCase() ?? "";

  const { data: insertedOrder, error: orderError } = await supabase
    .from("orders")
    .insert({
      workspace_id: targetWorkspaceId,
      client_id: clientId,
      device: input.device.trim(),
      car_number: input.carNumber?.trim() ?? "",
      description: input.description?.trim() || null,
      employee_id: employeeId,
      // Do not write employee ids into assigned_to (auth.users FK). Clear default auth.uid().
      assigned_to: null,
      ...(input.deadline ? { deadline: new Date(input.deadline).toISOString() } : {}),
      total_price: serviceTotal + materialTotal,
      status: "new",
      is_paid: false,
      number: `ORD-PENDING-${crypto.randomUUID()}`,
      vin: normalizedVin || null,
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
    })),
  );

  if (orderServicesError) {
    const { error: rollbackError } = await supabase.from("orders").delete().eq("id", order.id).eq("workspace_id", targetWorkspaceId);
    if (rollbackError) {
      throw new Error(`${orderServicesError.message}; order rollback failed: ${rollbackError.message}`);
    }
    throw new Error(orderServicesError.message);
  }

  if (materials.length > 0) {
    try {
      await syncOrderMaterialsRpc(String(order.id), materials);
    } catch (error) {
      const { error: rollbackError } = await supabase.from("orders").delete().eq("id", order.id).eq("workspace_id", targetWorkspaceId);
      const syncMessage = error instanceof Error ? error.message : String(error);
      if (rollbackError) {
        throw new Error(`${syncMessage}; order rollback failed: ${rollbackError.message}`);
      }
      throw error instanceof Error ? error : new Error(syncMessage);
    }
  }

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
    email: typeof client?.email === "string" ? client.email.trim() : "",
    phone: typeof client?.phone === "string" ? client.phone.trim() : "",
  };
}

type OrderServiceLine = { id?: string; order_id?: string; service_id?: string; service_name?: string; price?: number; quantity?: number };
type OrderMaterialLine = {
  id?: string;
  order_id?: string;
  inventory_item_id?: string;
  item_name?: string;
  price?: number;
  quantity?: number;
  quantity_issued?: number;
  quantity_returned?: number;
};

const orderServiceColumns = "id, order_id, service_id, service_name, price, quantity";
const orderMaterialColumns = "id, order_id, inventory_item_id, item_name, price, quantity, quantity_issued, quantity_returned";

function mapServiceLines(serviceLines: OrderServiceLine[]): OrderService[] {
  return serviceLines.map((line) => ({
    ...(line.id ? { id: String(line.id) } : {}),
    serviceId: String(line.service_id ?? ""),
    serviceName: String(line.service_name ?? ""),
    price: Number(line.price ?? 0),
    quantity: Number(line.quantity ?? 1),
  }));
}

function mapMaterialLines(materialLines: OrderMaterialLine[]): OrderMaterial[] {
  return materialLines.map((line) => ({
    ...(line.id ? { id: String(line.id) } : {}),
    inventoryItemId: String(line.inventory_item_id ?? ""),
    itemName: String(line.item_name ?? ""),
    price: Number(line.price ?? 0),
    quantity: Number(line.quantity ?? 1),
    quantityIssued: Number(line.quantity_issued ?? 0),
    quantityReturned: Number(line.quantity_returned ?? 0),
  }));
}

async function syncOrderMaterialsRpc(orderId: string, materials: OrderMaterial[]) {
  const payload = consolidateOrderMaterials(materials).map((line) => ({
    inventory_item_id: line.inventoryItemId,
    quantity: line.quantity,
  }));

  const { data, error } = await supabase.rpc("sync_order_materials", {
    p_order_id: orderId,
    p_materials: payload,
  });

  if (error) throw new Error(materialsSyncError(error));
  return mapMaterialLines((data ?? []) as OrderMaterialLine[]);
}

function toOrder(
  row: Record<string, unknown>,
  employees: { id: string; name: string; profile_id: string | null }[],
  serviceLines: OrderServiceLine[] = [],
  memberNames: Map<string, string> = new Map(),
  materialLines: OrderMaterialLine[] = [],
): Order {
  const employeeId = typeof row.employee_id === "string" ? row.employee_id.trim() : "";
  const legacyAssignedTo = typeof row.assigned_to === "string" ? row.assigned_to.trim() : "";
  const employee =
    (employeeId ? employees.find((item) => String(item.id) === employeeId) : undefined) ??
    (legacyAssignedTo ? employees.find((item) => String(item.id) === legacyAssignedTo) : undefined) ??
    (legacyAssignedTo ? employees.find((item) => item.profile_id != null && String(item.profile_id) === legacyAssignedTo) : undefined);
  const status = orderStatuses.has(row.status as OrderStatus) ? (row.status as OrderStatus) : "new";
  const isPaid = Boolean(row.is_paid);
  const paymentStatus: PaymentStatus = isPaid ? "paid" : "unpaid";
  const client = clientFromRow(row.clients);
  const services = mapServiceLines(serviceLines);
  const materials = mapMaterialLines(materialLines);
  const fallbackAssigneeId = employeeId || legacyAssignedTo;

  return {
    id: String(row.id),
    workspace_id: typeof row.workspace_id === "string" ? row.workspace_id : undefined,
    clientId: typeof row.client_id === "string" ? row.client_id : "",
    clientName: client.name,
    clientType: client.clientType,
    ...(client.email ? { clientEmail: client.email } : {}),
    ...(client.phone ? { clientPhone: client.phone } : {}),
    orderNumber: typeof row.number === "string" ? row.number : "",
    device: typeof row.device === "string" ? row.device : "",
    vin: readVin(row),
    carNumber: typeof row.car_number === "string" ? row.car_number : "",
    service: typeof row.service === "string" ? row.service : services.map((service) => service.serviceName).join(", "),
    services,
    materials,
    description: typeof row.description === "string" ? row.description : "",
    status,
    // Canonical: employees.id via orders.employee_id; legacy assigned_to only when employee_id is empty.
    assignedEmployeeId: employee?.id ?? fallbackAssigneeId,
    assignedEmployeeName: employee?.name || memberNames.get(legacyAssignedTo) || "",
    deadline: formatOrderDate(row.deadline),
    totalPrice: Number(row.total_price ?? 0),
    isPaid,
    paymentStatus,
    createdAt: formatOrderDate(row.created_at),
    updatedAt: formatOrderDate(row.updated_at),
  };
}

async function assigneeDisplayNames(workspaceId: string, assignedUserIds: string[]) {
  const names = new Map<string, string>();
  if (assignedUserIds.length === 0) return names;

  const wanted = new Set(assignedUserIds.map(String));
  const { data, error } = await supabase.rpc("workspace_member_profiles", { target_workspace: workspaceId });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return names;
    throw new Error(error.message);
  }

  for (const profile of (data ?? []) as { user_id?: string | null; id?: string | null; full_name?: string | null; email?: string | null }[]) {
    const raw = profile.user_id || profile.id;
    const userId = raw == null || raw === "" ? "" : String(raw);
    if (!userId || !wanted.has(userId)) continue;
    const label = profile.full_name?.trim() || profile.email?.trim();
    if (label) names.set(userId, label);
  }

  return names;
}

async function orderSearchFilter(workspaceId: string, term: string) {
  const filters = ["number", "device", "car_number", "vin", "service", "description"].map((column) => `${column}.ilike.%${term}%`);
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
  // Legacy assigned_to auth user ids only — used when employee_id is missing and no employee row matches.
  const legacyAuthIds = [
    ...new Set(
      rows
        .filter((row) => !(typeof row.employee_id === "string" && row.employee_id.trim()))
        .map((row) => (typeof row.assigned_to === "string" ? row.assigned_to.trim() : ""))
        .filter(Boolean),
    ),
  ];
  const memberNames = await assigneeDisplayNames(resolvedWorkspaceId, legacyAuthIds);
  let serviceLines: OrderServiceLine[] = [];
  let materialLines: OrderMaterialLine[] = [];

  if (orderIds.length > 0) {
    const [{ data: lines, error: linesError }, { data: materials, error: materialsError }] = await Promise.all([
      supabase.from("order_services").select(orderServiceColumns).in("order_id", orderIds).order("created_at", { ascending: true }),
      supabase.from("order_materials").select(orderMaterialColumns).in("order_id", orderIds).order("created_at", { ascending: true }),
    ]);

    if (linesError) throw new Error(linesError.message);
    if (materialsError) throw new Error(materialsError.message);
    serviceLines = lines ?? [];
    materialLines = materials ?? [];
  }

  return rows.map((row) =>
    toOrder(
      row,
      employees ?? [],
      serviceLines.filter((line) => line.order_id === row.id),
      memberNames,
      materialLines.filter((line) => line.order_id === row.id),
    ),
  );
}

export async function getOrder(orderId: string, workspaceId: string | undefined) {
  const orders = await getOrders(workspaceId);
  const order = orders.find((item) => item.id === orderId);
  if (!order) throw new Error(orderPermissionMessage());
  return order;
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
  if (!data || data.length === 0) throw new Error(orderPermissionMessage());
}

const orderColumns = "*,clients(name,client_type,email,phone)";

export function readVin(row: Record<string, unknown>) {
  if (typeof row.vin === "string" && row.vin) return row.vin;
  return "";
}

export async function updateOrder(
  { orderId, device, carNumber, vin = "", description, assignedEmployeeId, deadline, services, materials }: UpdateOrderDetails,
  targetWorkspaceId: string | undefined,
) {
  const workspaceId = requireWorkspaceId(targetWorkspaceId);
  if (services && services.length === 0) throw new Error(i18n.t("orders.validation.serviceRequired"));
  const employeeId = await resolveAssignedEmployeeId(workspaceId, assignedEmployeeId);
  const normalizedVin = vin.trim().toUpperCase();

  if (normalizedVin && normalizedVin.length !== 17) throw new Error(i18n.t("orders.validation.vinLength"));

  const { data, error } = await supabase
    .from("orders")
    .update({
      device: device.trim(),
      car_number: carNumber.trim().toUpperCase(),
      description: description.trim() || null,
      employee_id: employeeId,
      deadline: deadline ? `${deadline}T00:00:00.000Z` : null,
      vin: normalizedVin || null,
    })
    .eq("id", orderId)
    .eq("workspace_id", workspaceId)
    .select(orderColumns)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(orderPermissionMessage());

  let lines: OrderServiceLine[] = [];
  let summary: Record<string, unknown> | null = null;
  if (services) {
    ({ lines, summary } = await syncOrderServices(workspaceId, orderId, services));
  } else {
    // Assignee-only (and other partial) updates must keep existing service lines on the returned order.
    const { data: existingLines, error: linesError } = await supabase
      .from("order_services")
      .select(orderServiceColumns)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    if (linesError) throw new Error(linesError.message);
    lines = existingLines ?? [];
  }

  let materialLines: OrderMaterial[] = [];
  if (materials !== undefined) {
    const desiredMaterials = consolidateOrderMaterials(materials);
    if (desiredMaterials.length > 0) {
      // Non-empty: must sync via RPC. Failure throws — do not treat the update as fully successful.
      materialLines = await syncOrderMaterialsRpc(orderId, desiredMaterials);
    } else {
      const { data: existingMaterials, error: materialsError } = await supabase
        .from("order_materials")
        .select(orderMaterialColumns)
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });
      if (materialsError) throw new Error(materialsError.message);
      if ((existingMaterials ?? []).length > 0) {
        // Clearing saved lines still requires sync_order_materials; surface RPC errors (no silent success).
        materialLines = await syncOrderMaterialsRpc(orderId, []);
      } else {
        materialLines = [];
      }
    }
  } else {
    const { data: existingMaterials, error: materialsError } = await supabase
      .from("order_materials")
      .select(orderMaterialColumns)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    if (materialsError) throw new Error(materialsError.message);
    materialLines = mapMaterialLines(existingMaterials ?? []);
  }

  // If only services changed, refresh total so material amounts are not wiped.
  if (materials === undefined && summary) {
    const materialTotal = materialLines.reduce((total, line) => total + line.price * line.quantity, 0);
    const serviceTotal = lines.reduce((total, line) => total + Number(line.price ?? 0) * Number(line.quantity ?? 1), 0);
    summary = { ...summary, total_price: serviceTotal + materialTotal };
    const { data: updatedRows, error: totalError } = await supabase
      .from("orders")
      .update({ total_price: summary.total_price })
      .eq("id", orderId)
      .eq("workspace_id", workspaceId)
      .select("id");
    if (totalError) throw new Error(totalError.message);
    if (!updatedRows || updatedRows.length === 0) throw new Error(orderPermissionMessage());
  }

  const { data: refreshed, error: refreshError } = await supabase.from("orders").select(orderColumns).eq("id", orderId).eq("workspace_id", workspaceId).maybeSingle();
  if (refreshError) throw new Error(refreshError.message);

  const { data: employees, error: employeesError } = await supabase.from("employees").select("id, name, profile_id").eq("workspace_id", workspaceId);

  if (employeesError) throw new Error(employeesError.message);

  const row = (refreshed ?? data) as Record<string, unknown>;
  const hasEmployeeId = typeof row.employee_id === "string" && row.employee_id.trim() !== "";
  const legacyAssignedTo = !hasEmployeeId && typeof row.assigned_to === "string" ? String(row.assigned_to) : "";
  const memberNames = await assigneeDisplayNames(workspaceId, legacyAssignedTo ? [legacyAssignedTo] : []);
  return toOrder({ ...row, ...(summary ?? {}), ...(normalizedVin ? { vin: normalizedVin } : {}) }, employees ?? [], lines, memberNames, materialLines.map((line) => ({
    id: line.id,
    order_id: orderId,
    inventory_item_id: line.inventoryItemId,
    item_name: line.itemName,
    price: line.price,
    quantity: line.quantity,
    quantity_issued: line.quantityIssued,
    quantity_returned: line.quantityReturned,
  })));
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
    if (!deletedLines || deletedLines.length !== removedIds.length) throw new Error(orderPermissionMessage());
  }

  const lines = [...kept, ...inserted];
  if (newLines.length === 0 && removedIds.length === 0) return { lines, summary: null };

  const serviceTotal = lines.reduce((total, line) => total + Number(line.price ?? 0) * Number(line.quantity ?? 1), 0);
  const { data: materialRows, error: materialRowsError } = await supabase.from("order_materials").select("price, quantity").eq("order_id", orderId);
  if (materialRowsError) throw new Error(materialRowsError.message);
  const materialTotal = (materialRows ?? []).reduce((total, line) => total + Number(line.price ?? 0) * Number(line.quantity ?? 1), 0);

  const summary = {
    service: lines.map((line) => String(line.service_name ?? "")).join(", "),
    service_id: lines[0]?.service_id ?? null,
    total_price: serviceTotal + materialTotal,
  };

  const { data: updatedRows, error: summaryError } = await supabase.from("orders").update(summary).eq("id", orderId).eq("workspace_id", workspaceId).select("id");

  if (summaryError) throw new Error(summaryError.message);
  if (!updatedRows || updatedRows.length === 0) throw new Error(orderPermissionMessage());

  return { lines, summary };
}
