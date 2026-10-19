import i18n from "../i18n";
import type { Invoice, InvoiceDocument, InvoiceItem, InvoiceStatus } from "../lib/types";
import { readVin } from "./apiOrders";
import supabase from "./supabase";

const pendingNumberPrefix = "INV-PENDING-";
const issueNumberRequest = "INV-NEXT";

function invoicePermissionMessage() {
  return i18n.t("invoices.errors.noPermission");
}

export function invoicesUnavailableMessage() {
  return i18n.t("invoices.errors.unavailable");
}

/** The invoices tables are missing from the connected database (PostgREST PGRST205 / Postgres 42P01). */
export class InvoicesUnavailableError extends Error {
  constructor() {
    super(invoicesUnavailableMessage());
    this.name = "InvoicesUnavailableError";
  }
}

type DbError = { code?: string; message: string };

function toInvoiceError(error: DbError) {
  if (error.code === "PGRST205" || error.code === "42P01") return new InvoicesUnavailableError();
  return new Error(error.message);
}

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return workspaceId;
}

export function alreadyInvoicedMessage(invoiceNumber?: string) {
  return invoiceNumber ? i18n.t("invoices.errors.alreadyInvoiced", { number: invoiceNumber }) : i18n.t("invoices.errors.alreadyInvoicedUnknown");
}

const invoiceStatuses = new Set<InvoiceStatus>(["draft", "sent", "paid", "overdue"]);
const invoiceColumns =
  "id, workspace_id, order_id, client_id, number, status, client_name, order_number, device, car_number, vin, description, subtotal, total, due_date, paid_at, created_by, created_at, updated_at";
const invoiceListColumns = `${invoiceColumns},clients(phone)`;
const invoiceItemColumns = "id, invoice_id, service_id, service_name, price, quantity, position, created_at";

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function clientPhoneFromRow(clients: unknown) {
  const client: Record<string, unknown> | null = Array.isArray(clients)
    ? (clients[0] as Record<string, unknown> | undefined) ?? null
    : clients && typeof clients === "object"
      ? (clients as Record<string, unknown>)
      : null;
  return typeof client?.phone === "string" ? client.phone.trim() : "";
}

async function memberDisplayNames(workspaceId: string, userIds: string[]) {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;

  const wanted = new Set(userIds.map(String));
  const { data, error } = await supabase.rpc("workspace_member_profiles", { target_workspace: workspaceId });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return names;
    throw toInvoiceError(error);
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

function toInvoice(row: Record<string, unknown>, memberNames: Map<string, string> = new Map()): Invoice {
  const status = invoiceStatuses.has(row.status as InvoiceStatus) ? (row.status as InvoiceStatus) : "draft";
  const total = Number(row.total ?? 0);
  const createdById = text(row.created_by);
  const clientPhone = clientPhoneFromRow(row.clients);
  return {
    id: String(row.id),
    workspaceId: text(row.workspace_id),
    invoiceNumber: text(row.number),
    clientId: text(row.client_id),
    clientName: text(row.client_name),
    ...(clientPhone ? { clientPhone } : {}),
    ...(text(row.order_id) ? { orderId: text(row.order_id) } : {}),
    ...(text(row.order_number) ? { orderNumber: text(row.order_number) } : {}),
    device: text(row.device),
    carNumber: text(row.car_number),
    vin: text(row.vin),
    description: text(row.description),
    subtotal: Number(row.subtotal ?? 0),
    amount: total,
    total,
    status,
    dueDate: text(row.due_date).slice(0, 10),
    createdAt: text(row.created_at).slice(0, 10),
    updatedAt: text(row.updated_at).slice(0, 10),
    ...(text(row.paid_at) ? { paidAt: text(row.paid_at).slice(0, 10) } : {}),
    ...(createdById
      ? {
          createdById,
          createdByName: memberNames.get(createdById) || "",
        }
      : {}),
  };
}

function toInvoiceItem(row: Record<string, unknown>): InvoiceItem {
  return {
    id: String(row.id),
    invoiceId: text(row.invoice_id),
    serviceId: text(row.service_id) || null,
    serviceName: text(row.service_name),
    price: Number(row.price ?? 0),
    quantity: Number(row.quantity ?? 1),
    position: Number(row.position ?? 0),
    createdAt: text(row.created_at).slice(0, 10),
  };
}

function toInvoiceDocument(row: Record<string, unknown>, items: Record<string, unknown>[], memberNames: Map<string, string> = new Map()): InvoiceDocument {
  return {
    ...toInvoice(row, memberNames),
    items: [...items].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0)).map(toInvoiceItem),
  };
}

/** Invoices of the workspace, newest first. Invoices still being numbered are left out. */
export async function getInvoices(workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("invoices")
    .select(invoiceListColumns)
    .eq("workspace_id", targetWorkspaceId)
    .order("created_at", { ascending: false });

  if (error) throw toInvoiceError(error);
  const rows = ((data ?? []) as Record<string, unknown>[]).filter((row) => !text(row.number).startsWith(pendingNumberPrefix));
  const createdByIds = rows.map((row) => text(row.created_by)).filter(Boolean);
  const memberNames = await memberDisplayNames(targetWorkspaceId, [...new Set(createdByIds)]);
  return rows.map((row) => toInvoice(row, memberNames));
}

/** One invoice of the workspace with the lines it copied from its order. */
export async function getInvoice(invoiceId: string, workspaceId: string | undefined): Promise<InvoiceDocument> {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("invoices")
    .select(invoiceListColumns)
    .eq("id", invoiceId)
    .eq("workspace_id", targetWorkspaceId)
    .maybeSingle();

  if (error) throw toInvoiceError(error);
  if (!data) throw new Error(i18n.t("invoices.errors.notFound"));

  const { data: items, error: itemsError } = await supabase.from("invoice_items").select(invoiceItemColumns).eq("invoice_id", invoiceId).order("position", { ascending: true });
  if (itemsError) throw toInvoiceError(itemsError);

  const row = data as Record<string, unknown>;
  const createdById = text(row.created_by);
  const memberNames = await memberDisplayNames(targetWorkspaceId, createdById ? [createdById] : []);
  return toInvoiceDocument(row, (items ?? []) as Record<string, unknown>[], memberNames);
}

/** Moves an invoice to another status; paid_at is set when it becomes paid and cleared otherwise. */
export async function updateInvoiceStatus(invoiceId: string, status: InvoiceStatus, workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("invoices")
    .update({ status, paid_at: status === "paid" ? new Date().toISOString() : null })
    .eq("id", invoiceId)
    .eq("workspace_id", targetWorkspaceId)
    .select(invoiceColumns)
    .maybeSingle();

  if (error) throw toInvoiceError(error);
  if (!data) throw new Error(invoicePermissionMessage());
  return toInvoice(data as Record<string, unknown>);
}

// The database replaces 'INV-NEXT' with the next 'INV-YYYY-NNN' of the workspace: the year of the
// stored created_at in the workspace time zone and a per-year counter that never goes back, so the
// number of a deleted invoice is not issued again
// (supabase/migrations/20261004020000_invoice_number_counters.sql).
async function issueInvoiceNumber(workspaceId: string, invoice: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("invoices")
    .update({ number: issueNumberRequest })
    .eq("id", invoice.id)
    .eq("workspace_id", workspaceId)
    .eq("number", invoice.number)
    .select(invoiceColumns)
    .maybeSingle();

  if (error) throw toInvoiceError(error);
  if (!data) throw new Error(invoicePermissionMessage());
  return data as Record<string, unknown>;
}

// An invoice left with a temporary number (its creation was interrupted) must not block the order,
// so it is removed. The number filter keeps an invoice that was numbered in the meantime.
async function ensureOrderNotInvoiced(workspaceId: string, orderId: string) {
  const { data, error } = await supabase.from("invoices").select("id, number").eq("workspace_id", workspaceId).eq("order_id", orderId);

  if (error) throw toInvoiceError(error);

  for (const invoice of (data ?? []) as Record<string, unknown>[]) {
    const number = text(invoice.number);
    if (!number.startsWith(pendingNumberPrefix)) throw new Error(alreadyInvoicedMessage(number));

    const { error: deleteError } = await supabase.from("invoices").delete().eq("id", invoice.id).eq("workspace_id", workspaceId).eq("number", number);
    if (deleteError) throw toInvoiceError(deleteError);
  }
}

/**
 * Creates an invoice that copies the order's client, details and service lines as they are now.
 * Later edits to the order do not change the invoice. One invoice per order.
 */
export async function createInvoiceFromOrder(orderId: string, workspaceId: string | undefined): Promise<InvoiceDocument> {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);

  await ensureOrderNotInvoiced(targetWorkspaceId, orderId);

  const { data: order, error: orderError } = await supabase.from("orders").select("*,clients(name)").eq("id", orderId).eq("workspace_id", targetWorkspaceId).maybeSingle();

  if (orderError) throw new Error(orderError.message);
  if (!order) throw new Error(i18n.t("invoices.errors.orderNotFound"));

  const [{ data: lines, error: linesError }, { data: materialLines, error: materialsError }] = await Promise.all([
    supabase.from("order_services").select("service_id, service_name, price, quantity").eq("order_id", orderId).order("created_at", { ascending: true }),
    supabase.from("order_materials").select("item_name, price, quantity").eq("order_id", orderId).order("created_at", { ascending: true }),
  ]);

  if (linesError) throw new Error(linesError.message);
  if (materialsError) throw new Error(materialsError.message);

  const serviceItems = ((lines ?? []) as Record<string, unknown>[]).map((line) => ({
    service_id: text(line.service_id) || null,
    service_name: text(line.service_name),
    price: Number(line.price ?? 0),
    quantity: Number(line.quantity ?? 1),
  }));
  const materialItems = ((materialLines ?? []) as Record<string, unknown>[]).map((line) => ({
    service_id: null as string | null,
    service_name: text(line.item_name),
    price: Number(line.price ?? 0),
    quantity: Number(line.quantity ?? 1),
  }));

  if (serviceItems.length === 0 && materialItems.length === 0) throw new Error(i18n.t("invoices.errors.orderHasNoServices"));

  const items = [...serviceItems, ...materialItems].map((item, index) => ({ ...item, position: index }));
  const subtotal = toMoney(items.reduce((total, item) => total + item.price * item.quantity, 0));
  const orderRow = order as Record<string, unknown>;
  const client = Array.isArray(orderRow.clients) ? orderRow.clients[0] : orderRow.clients;

  const { data: inserted, error: insertError } = await supabase
    .from("invoices")
    .insert({
      workspace_id: targetWorkspaceId,
      order_id: orderId,
      client_id: text(orderRow.client_id) || null,
      number: `${pendingNumberPrefix}${crypto.randomUUID()}`,
      status: "draft",
      client_name: text((client as Record<string, unknown> | null)?.name),
      order_number: text(orderRow.number),
      device: text(orderRow.device),
      car_number: text(orderRow.car_number),
      vin: readVin(orderRow),
      description: text(orderRow.description),
      subtotal,
      total: subtotal,
    })
    .select(invoiceColumns)
    .single();

  if (insertError) throw insertError.code === "23505" ? new Error(alreadyInvoicedMessage()) : toInvoiceError(insertError);

  const insertedInvoice = inserted as Record<string, unknown>;

  // The number is issued last, so a creation that fails on the way leaves only an unfinished
  // invoice, which is removed without using up a number.
  try {
    const { data: savedItems, error: itemsError } = await supabase
      .from("invoice_items")
      .insert(items.map((item) => ({ invoice_id: insertedInvoice.id, ...item })))
      .select(invoiceItemColumns);

    if (itemsError) throw toInvoiceError(itemsError);
    const invoice = await issueInvoiceNumber(targetWorkspaceId, insertedInvoice);
    return toInvoiceDocument(invoice, (savedItems ?? []) as Record<string, unknown>[]);
  } catch (error) {
    await supabase.from("invoices").delete().eq("id", insertedInvoice.id).eq("workspace_id", targetWorkspaceId).eq("number", text(insertedInvoice.number));
    throw error;
  }
}
