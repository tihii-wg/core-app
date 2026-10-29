import type { CreateOrderInput, Order, OrderMaterial, OrderService, OrderStatus, PaymentStatus, UpdateOrderDetails } from "../lib/types";
import { nullIfEmptyText, nullIfEmptyUuid } from "../lib/nullish";
import { assertValidOptionalVin } from "../lib/vin";
import { assertVehicleAssignable } from "./apiVehicles";
import { consolidateOrderMaterials } from "../features/inventory/orderMaterialLine";
import {
  addCalendarDays,
  OPEN_ORDER_STATUSES,
  UPCOMING_DEADLINE_DAYS,
  type DeadlineFilter,
} from "../features/orders/orderVisibility";
import { isLegalEntityCustomer, taxInvoiceNumberPresent } from "../features/orders/taxInvoice";
import { createClient, getClients, toClientType } from "./apiClients";
import { createService } from "./apiServices";
import supabase from "./supabase";
import { searchTerm } from "./searchTerm";
import i18n from "../i18n";

export const ORDERS_PAGE_SIZES = [25, 50, 100] as const;
export type OrdersPageSize = (typeof ORDERS_PAGE_SIZES)[number];
export const DEFAULT_ORDERS_PAGE_SIZE: OrdersPageSize = 25;

export type OrdersListQuery = {
  search?: string;
  status?: OrderStatus | "all";
  deadline?: DeadlineFilter;
  /** employees.id; omit / "all" = no assignee filter */
  employeeId?: string | "all";
  /** Local YYYY-MM-DD used for deadline filters (matches client calendar logic). */
  today: string;
  page: number;
  pageSize: OrdersPageSize;
};

export type OrdersPageResult = {
  orders: Order[];
  total: number;
  page: number;
  pageSize: OrdersPageSize;
  pageCount: number;
};

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

/** Resolve client for create. Empty clientId + empty name → NULL (draft without client). */
async function resolveClientId(workspaceId: string, { clientId, clientName, clientType, clientTaxId, clientContactPerson, clientEmail = "", clientPhone = "" }: CreateOrderInput) {
  const existingId = nullIfEmptyUuid(clientId);
  if (existingId) return existingId;

  const name = clientName?.trim() ?? "";
  if (!name) return null;

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

  const resolvedServices = [];
  for (const service of input.services ?? []) {
    const resolved = await resolveService(targetWorkspaceId, service);
    resolvedServices.push({
      ...resolved,
      price: service.price,
      quantity: service.quantity,
    });
  }

  const employeeId = await resolveAssignedEmployeeId(targetWorkspaceId, input.assignedEmployeeId);
  const clientId = await resolveClientId(targetWorkspaceId, input);
  const vehicleId = await assertVehicleAssignable(targetWorkspaceId, clientId, nullIfEmptyUuid(input.vehicleId));
  const materials = consolidateOrderMaterials(input.materials ?? []);

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!user) throw new Error(i18n.t("clients.errors.notAuthenticated"));

  const serviceTotal = resolvedServices.reduce((total, service) => total + service.price * service.quantity, 0);
  const materialTotal = materials.reduce((total, line) => total + line.price * line.quantity, 0);
  const timeZone = await workspaceTimeZone(targetWorkspaceId);
  const normalizedVin = assertValidOptionalVin(input.vin, "orders.validation.vinLength");
  const device = nullIfEmptyText(input.device);
  const carNumber = nullIfEmptyText(input.carNumber)?.toUpperCase() ?? null;

  const { data: insertedOrder, error: orderError } = await supabase
    .from("orders")
    .insert({
      workspace_id: targetWorkspaceId,
      client_id: clientId,
      vehicle_id: vehicleId,
      device,
      car_number: carNumber,
      description: nullIfEmptyText(input.description),
      employee_id: employeeId,
      // Do not write employee ids into assigned_to (auth.users FK). Clear default auth.uid().
      assigned_to: null,
      created_by: user.id,
      ...(input.deadline ? { deadline: new Date(input.deadline).toISOString() } : { deadline: null }),
      total_price: serviceTotal + materialTotal,
      status: "new",
      is_paid: false,
      number: `ORD-PENDING-${crypto.randomUUID()}`,
      vin: normalizedVin,
      service_id: resolvedServices[0]?.id ?? null,
      service: resolvedServices.length > 0 ? resolvedServices.map((service) => service.name).join(", ") : null,
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

  if (resolvedServices.length > 0) {
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

// Explicit tax_invoice_number so PostgREST always returns it even if a stale
// schema-cache expansion of `*` ever omitted a newly added column.
const orderColumns = "*,tax_invoice_number,clients(name,client_type,email,phone)";
const orderServiceColumns = "id, order_id, service_id, service_name, price, quantity";
const orderMaterialColumns = "id, order_id, inventory_item_id, item_name, price, quantity, quantity_issued, quantity_returned";

/** Reads orders.tax_invoice_number; coerces unexpected non-null types instead of dropping them. */
export function readTaxInvoiceNumber(row: Record<string, unknown>) {
  const raw = row.tax_invoice_number;
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  return String(raw);
}

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
  const createdById = typeof row.created_by === "string" ? row.created_by.trim() : "";

  return {
    id: String(row.id),
    workspace_id: typeof row.workspace_id === "string" ? row.workspace_id : undefined,
    clientId: typeof row.client_id === "string" ? row.client_id : "",
    clientName: client.name,
    clientType: client.clientType,
    ...(client.email ? { clientEmail: client.email } : {}),
    ...(client.phone ? { clientPhone: client.phone } : {}),
    orderNumber: typeof row.number === "string" ? row.number : "",
    vehicleId: typeof row.vehicle_id === "string" ? row.vehicle_id : null,
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
    taxInvoiceNumber: readTaxInvoiceNumber(row),
    ...(createdById
      ? {
          createdById,
          createdByName: memberNames.get(createdById) || "",
        }
      : {}),
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

async function hydrateOrderRows(workspaceId: string, rows: Record<string, unknown>[]): Promise<Order[]> {
  const { data: employees, error: employeesError } = await supabase.from("employees").select("id, name, profile_id").eq("workspace_id", workspaceId);

  if (employeesError) throw new Error(employeesError.message);

  const orderIds = rows.map((row) => String(row.id)).filter(Boolean);
  // Legacy assigned_to auth user ids only — used when employee_id is missing and no employee row matches.
  const legacyAuthIds = rows
    .filter((row) => !(typeof row.employee_id === "string" && row.employee_id.trim()))
    .map((row) => (typeof row.assigned_to === "string" ? row.assigned_to.trim() : ""))
    .filter(Boolean);
  const createdByIds = rows.map((row) => (typeof row.created_by === "string" ? row.created_by.trim() : "")).filter(Boolean);
  const memberNames = await assigneeDisplayNames(workspaceId, [...new Set([...legacyAuthIds, ...createdByIds])]);
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

type OrdersFilterInput = {
  search?: string;
  status?: OrderStatus | "all";
  deadline?: DeadlineFilter;
  employeeId?: string | "all";
  today: string;
};

/** Statuses to send to PostgREST for the combined status + deadline filters. Empty = no matches. */
function statusesForOrdersFilter(status: OrderStatus | "all" = "all", deadline: DeadlineFilter = "all"): OrderStatus[] | null {
  if (deadline === "all") {
    if (status === "all") return null;
    return [status];
  }
  if (status === "all") return [...OPEN_ORDER_STATUSES];
  return OPEN_ORDER_STATUSES.includes(status) ? [status] : [];
}

/**
 * Applies list filters to a Supabase orders query.
 * Returns `{ query }` (never the builder alone) so `await` cannot unwrap the Thenable client.
 * Returns null when the filter combo cannot match.
 */
async function applyOrdersListFilters(
  // PostgREST builders are invariant; keep this untyped at the boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  workspaceId: string,
  { search = "", status = "all", deadline = "all", employeeId = "all", today }: OrdersFilterInput,
): Promise<{ query: typeof query } | null> {
  const statuses = statusesForOrdersFilter(status, deadline);
  if (statuses && statuses.length === 0) return null;
  if (statuses) query = query.in("status", statuses);

  // NULL deadlines never satisfy inequality filters in Postgres, matching client-side checks.
  if (deadline === "overdue") {
    query = query.lt("deadline", `${today}T00:00:00.000Z`);
  } else if (deadline === "upcoming") {
    const until = addCalendarDays(today, UPCOMING_DEADLINE_DAYS);
    query = query.gte("deadline", `${today}T00:00:00.000Z`).lte("deadline", `${until}T23:59:59.999Z`);
  }

  const assignee = employeeId === "all" ? "" : employeeId.trim();
  if (assignee) query = query.eq("employee_id", assignee);

  const term = searchTerm(search);
  if (term) query = query.or(await orderSearchFilter(workspaceId, term));

  return { query };
}

/** Full workspace order list (dashboard, notifications, search). Prefer getOrdersPage for the Orders table. */
export async function getOrders(workspaceId: string | undefined, search = "") {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);

  let query = supabase.from("orders").select(orderColumns).eq("workspace_id", resolvedWorkspaceId);

  const term = searchTerm(search);
  if (term) query = query.or(await orderSearchFilter(resolvedWorkspaceId, term));

  const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false });

  if (error) throw new Error(error.message);

  return hydrateOrderRows(resolvedWorkspaceId, (data ?? []) as Record<string, unknown>[]);
}

/**
 * Server-paginated orders for the Orders page.
 * Filters and stable sort (created_at desc, id desc) run before `.range()`.
 */
export async function getOrdersPage(workspaceId: string | undefined, input: OrdersListQuery): Promise<OrdersPageResult> {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);
  const pageSize = ORDERS_PAGE_SIZES.includes(input.pageSize) ? input.pageSize : DEFAULT_ORDERS_PAGE_SIZE;
  const page = Math.max(1, Math.floor(input.page) || 1);

  const empty = (): OrdersPageResult => ({ orders: [], total: 0, page: 1, pageSize, pageCount: 1 });

  let query = supabase
    .from("orders")
    .select(orderColumns, { count: "exact" })
    .eq("workspace_id", resolvedWorkspaceId);

  const filtered = await applyOrdersListFilters(query, resolvedWorkspaceId, input);
  if (!filtered) return empty();
  query = filtered.query;

  // Stable ordering so pages don't shuffle when timestamps collide.
  query = query.order("created_at", { ascending: false }).order("id", { ascending: false });

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await query.range(from, to);

  if (error) throw new Error(error.message);

  const total = typeof count === "number" && count >= 0 ? count : (data ?? []).length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // If the requested page is past the end (e.g. last row deleted), re-fetch the last page once.
  if (total > 0 && page > pageCount) {
    return getOrdersPage(workspaceId, { ...input, page: pageCount, pageSize });
  }

  const orders = await hydrateOrderRows(resolvedWorkspaceId, (data ?? []) as Record<string, unknown>[]);
  return {
    orders,
    total,
    page: total === 0 ? 1 : page,
    pageSize,
    pageCount: total === 0 ? 1 : pageCount,
  };
}

export type OrdersAwaitingPayment = {
  amount: number;
  count: number;
};

/**
 * Workspace total for unpaid, non-cancelled orders (same rule as dashboard outstanding).
 * Loads only `total_price` rows — not full order hydration.
 */
export async function getOrdersAwaitingPayment(workspaceId: string | undefined): Promise<OrdersAwaitingPayment> {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("orders")
    .select("total_price")
    .eq("workspace_id", resolvedWorkspaceId)
    .eq("is_paid", false)
    .neq("status", "cancelled");

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  return {
    amount: rows.reduce((sum, row) => sum + Number((row as { total_price?: unknown }).total_price ?? 0), 0),
    count: rows.length,
  };
}

export async function getOrder(orderId: string, workspaceId: string | undefined) {
  const orders = await getOrders(workspaceId);
  const order = orders.find((item) => item.id === orderId);
  if (!order) throw new Error(orderPermissionMessage());
  return order;
}

/** String helper used by tests; same trim rules as `taxInvoiceNumberPresent`. */
export function hasTaxInvoiceNumber(value: string | null | undefined) {
  return taxInvoiceNumberPresent(value);
}

/**
 * Whether the workspace requires a tax invoice number before an order may be
 * marked paid. Missing-column errors (older databases) degrade to "not
 * required" so existing flows keep working.
 */
async function workspaceRequiresTaxInvoice(workspaceId: string) {
  try {
    const { data, error } = await supabase.from("workspaces").select("require_tax_invoice_number").eq("id", workspaceId).maybeSingle();
    if (error) return false;
    return (data as { require_tax_invoice_number?: unknown } | null)?.require_tax_invoice_number === true;
  } catch {
    return false;
  }
}

/**
 * Authoritative paid-gate for legal-entity orders: reads the current
 * `clients.client_type` and `orders.tax_invoice_number` from Supabase (not the
 * React Query cache). Fails closed when the check query errors so a transient
 * failure cannot skip the requirement.
 */
async function assertTaxInvoiceAllowsPaid(orderId: string, workspaceId: string) {
  if (!(await workspaceRequiresTaxInvoice(workspaceId))) return;

  const { data: orderRow, error } = await supabase
    .from("orders")
    .select("tax_invoice_number, clients(client_type)")
    .eq("id", orderId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!orderRow) throw new Error(orderPermissionMessage());

  const client = (orderRow as { clients?: unknown }).clients;
  const clientRecord = Array.isArray(client) ? client[0] : client;
  const rawType =
    clientRecord && typeof clientRecord === "object"
      ? (clientRecord as { client_type?: unknown }).client_type
      : null;
  const clientType = toClientType(rawType);

  if (isLegalEntityCustomer(clientType) && !taxInvoiceNumberPresent(readTaxInvoiceNumber(orderRow as Record<string, unknown>))) {
    throw new Error(i18n.t("orders.taxInvoice.required"));
  }
}

/**
 * Verifies the signed-in user is `workspaces.owner_id` for this workspace.
 * Uses the authenticated Supabase client — never a client-supplied owner flag.
 */
async function isAuthenticatedWorkspaceOwner(workspaceId: string) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) return false;

  const { data, error } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data != null;
}

/**
 * Sole application write path that can set `orders.status = paid` / `is_paid`.
 * Every UI entry point (order menu, detail panel, etc.) goes through
 * `useUpdateOrderStatus` → this function. Direct Supabase/SQL updates are
 * outside app enforcement (no DB trigger in this codebase).
 *
 * Paid is locked for non-owners: the persisted `status` is re-read, and only
 * `workspaces.owner_id === auth.uid()` may move a Paid order to another status.
 * Non-owner updates keep `.neq("status","paid")` so a concurrent Paid write cannot be overwritten.
 */
export async function updateOrderStatus(orderId: string, status: OrderStatus, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);

  const { data: existing, error: loadError } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .eq("workspace_id", targetWorkspaceId)
    .maybeSingle();

  if (loadError) throw new Error(loadError.message);
  if (!existing) throw new Error(orderPermissionMessage());

  const currentStatus =
    typeof (existing as { status?: unknown }).status === "string" ? (existing as { status: string }).status : "";

  let ownerMayChangePaid = false;
  if (currentStatus === "paid") {
    if (status === "paid") return;
    ownerMayChangePaid = await isAuthenticatedWorkspaceOwner(targetWorkspaceId);
    if (!ownerMayChangePaid) {
      throw new Error(i18n.t("orders.errors.paidStatusLocked"));
    }
  }

  if (status === "paid") {
    await assertTaxInvoiceAllowsPaid(orderId, targetWorkspaceId);
  }

  const payload =
    status === "paid"
      ? { status, is_paid: true }
      : currentStatus === "paid"
        ? { status, is_paid: false }
        : { status };

  let updateQuery = supabase
    .from("orders")
    .update(payload)
    .eq("id", orderId)
    .eq("workspace_id", targetWorkspaceId);

  // Non-owners (and unpaid→* paths) must not overwrite a status that became Paid after the read.
  if (!ownerMayChangePaid) {
    updateQuery = updateQuery.neq("status", "paid");
  }

  const { data, error } = await updateQuery.select("id");

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    const { data: again, error: againError } = await supabase
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .eq("workspace_id", targetWorkspaceId)
      .maybeSingle();
    if (againError) throw new Error(againError.message);
    if (again && (again as { status?: unknown }).status === "paid") {
      throw new Error(i18n.t("orders.errors.paidStatusLocked"));
    }
    throw new Error(orderPermissionMessage());
  }
}

/** Saves (or clears, when blank) the tax invoice number of one order. Trims whitespace. */
export async function updateOrderTaxInvoiceNumber(orderId: string, taxInvoiceNumber: string, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const trimmed = taxInvoiceNumber.trim();

  const { data, error } = await supabase
    .from("orders")
    .update({ tax_invoice_number: trimmed || null })
    .eq("id", orderId)
    .eq("workspace_id", targetWorkspaceId)
    // Round-trip the persisted column so callers adopt the DB value, not only the local trim.
    .select("tax_invoice_number")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(orderPermissionMessage());
  return readTaxInvoiceNumber(data as Record<string, unknown>);
}

export function readVin(row: Record<string, unknown>) {
  if (typeof row.vin === "string" && row.vin) return row.vin;
  return "";
}

export async function updateOrder(
  { orderId, vehicleId, device, carNumber, vin = "", description, assignedEmployeeId, deadline, services, materials }: UpdateOrderDetails,
  targetWorkspaceId: string | undefined,
) {
  const workspaceId = requireWorkspaceId(targetWorkspaceId);
  const employeeId = await resolveAssignedEmployeeId(workspaceId, assignedEmployeeId);
  const normalizedVin = assertValidOptionalVin(vin, "orders.validation.vinLength");

  const { data: existingOrder, error: existingError } = await supabase
    .from("orders")
    .select("client_id")
    .eq("id", orderId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existingOrder) throw new Error(orderPermissionMessage());

  const clientId = typeof existingOrder.client_id === "string" ? existingOrder.client_id : null;
  // Omit vehicleId from the payload to leave orders.vehicle_id unchanged (assignee-only updates).
  const vehiclePatch =
    vehicleId === undefined
      ? {}
      : { vehicle_id: await assertVehicleAssignable(workspaceId, clientId, nullIfEmptyUuid(vehicleId)) };

  const { data, error } = await supabase
    .from("orders")
    .update({
      ...vehiclePatch,
      device: nullIfEmptyText(device),
      car_number: nullIfEmptyText(carNumber)?.toUpperCase() ?? null,
      description: nullIfEmptyText(description),
      employee_id: employeeId,
      deadline: deadline ? `${deadline}T00:00:00.000Z` : null,
      vin: normalizedVin,
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
  const createdById = typeof row.created_by === "string" ? row.created_by.trim() : "";
  const memberNames = await assigneeDisplayNames(
    workspaceId,
    [...new Set([legacyAssignedTo, createdById].filter(Boolean))],
  );
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

function isMissingRelationError(error: { code?: string } | null | undefined) {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

/** Map order-delete FK / integrity / RPC failures to localized copy (never surface raw SQL). */
export function mapOrderDeleteDbError(error: { code?: string; message?: string; details?: string | null; hint?: string | null }) {
  const blob = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
  if (/order_delete:has_invoice/i.test(blob)) {
    return new Error(i18n.t("orders.errors.cannotDeleteWithInvoice"));
  }
  if (/order_delete:not_member|order_delete:not_authenticated/i.test(blob) || error.code === "42501") {
    return new Error(i18n.t("orders.errors.deleteForbidden"));
  }
  if (/order_delete:not_found/i.test(blob)) {
    return new Error(orderPermissionMessage());
  }
  if (error.code === "PGRST202" || error.code === "42883" || /could not find the function|function .* does not exist/i.test(blob)) {
    return new Error(i18n.t("orders.errors.deleteWithPaymentsRpcMissing"));
  }
  if (error.code === "23503" || /foreign key|violates foreign key/i.test(blob)) {
    if (/payments_order_id_fkey|table ["']?payments["']?/i.test(blob)) {
      return new Error(i18n.t("orders.errors.deleteWithPaymentsRpcMissing"));
    }
    if (/invoices_.*order_id|table ["']?invoices["']?/i.test(blob)) {
      return new Error(i18n.t("orders.errors.cannotDeleteWithInvoice"));
    }
  }
  return new Error(error.message || i18n.t("common.somethingWentWrong"));
}

export type DeleteOrderResult = {
  id: string;
  paymentsDeleted: number;
};

async function countOrderPayments(workspaceId: string, orderId: string): Promise<number> {
  const { count, error } = await supabase
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("order_id", orderId);
  if (error) {
    if (isMissingRelationError(error)) return 0;
    throw new Error(error.message);
  }
  return count ?? 0;
}

/**
 * Hard-delete an order in the active workspace.
 * Invoices always block (nothing is deleted).
 * Linked payments require the reviewed RPC `delete_order_with_payments` (append-only ledger:
 * clients must not DELETE payments directly). Without that RPC, orders with payments cannot be removed.
 * Order service/material lines follow DB CASCADE when present.
 */
export async function deleteOrder(orderId: string, workspaceId: string | undefined): Promise<DeleteOrderResult> {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const id = orderId.trim();
  if (!id) throw new Error(orderPermissionMessage());

  const { data: invoices, error: invoiceError } = await supabase
    .from("invoices")
    .select("id")
    .eq("workspace_id", targetWorkspaceId)
    .eq("order_id", id)
    .limit(1);
  if (invoiceError) {
    // Missing invoices table/relation should not block unrelated workspaces; only surface real errors.
    if (!isMissingRelationError(invoiceError)) {
      throw new Error(invoiceError.message);
    }
  } else if ((invoices ?? []).length > 0) {
    throw new Error(i18n.t("orders.errors.cannotDeleteWithInvoice"));
  }

  const paymentCount = await countOrderPayments(targetWorkspaceId, id);

  // Atomic path: SECURITY DEFINER RPC deletes order-linked payments then the order.
  // Always preferred so payment+order never split across client round-trips.
  const { data: rpcData, error: rpcError } = await supabase.rpc("delete_order_with_payments", {
    p_workspace_id: targetWorkspaceId,
    p_order_id: id,
  });

  if (!rpcError) {
    const payload = rpcData as { order_id?: string; payments_deleted?: number } | null;
    return {
      id: payload?.order_id ?? id,
      paymentsDeleted: typeof payload?.payments_deleted === "number" ? payload.payments_deleted : paymentCount,
    };
  }

  const rpcMissing =
    rpcError.code === "PGRST202" ||
    rpcError.code === "42883" ||
    /could not find the function|function .* does not exist/i.test(rpcError.message ?? "");

  if (!rpcMissing) {
    throw mapOrderDeleteDbError(rpcError);
  }

  // RPC not installed yet: only allow plain order delete when no payment rows exist.
  if (paymentCount > 0) {
    throw new Error(i18n.t("orders.errors.deleteWithPaymentsRpcMissing"));
  }

  const { data, error } = await supabase
    .from("orders")
    .delete()
    .eq("id", id)
    .eq("workspace_id", targetWorkspaceId)
    .select("id")
    .maybeSingle();

  if (error) throw mapOrderDeleteDbError(error);
  if (!data) throw new Error(orderPermissionMessage());
  return { id, paymentsDeleted: 0 };
}
