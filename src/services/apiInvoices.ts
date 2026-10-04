import type { Invoice, InvoiceDocument, InvoiceItem, InvoiceStatus } from "../lib/types";
import { readVin } from "./apiOrders";
import supabase from "./supabase";

const pendingNumberPrefix = "INV-PENDING-";
const issueNumberRequest = "INV-NEXT";
const invoicePermissionMessage = "Invoice was not found or you do not have permission to change it.";
export const invoicesUnavailableMessage = "Invoices are not set up in this database yet. The invoices migration has to be applied first.";

/** The invoices tables are missing from the connected database (PostgREST PGRST205 / Postgres 42P01). */
export class InvoicesUnavailableError extends Error {
  constructor() {
    super(invoicesUnavailableMessage);
    this.name = "InvoicesUnavailableError";
  }
}

type DbError = { code?: string; message: string };

function toInvoiceError(error: DbError) {
  if (error.code === "PGRST205" || error.code === "42P01") return new InvoicesUnavailableError();
  return new Error(error.message);
}

function requireWorkspaceId(workspaceId: string | undefined) {
  if (!workspaceId) throw new Error("No active workspace selected");
  return workspaceId;
}

export function alreadyInvoicedMessage(invoiceNumber?: string) {
  return invoiceNumber ? `Invoice ${invoiceNumber} already exists for this order.` : "An invoice already exists for this order.";
}

const invoiceStatuses = new Set<InvoiceStatus>(["draft", "sent", "paid", "overdue"]);
const invoiceColumns = "id, workspace_id, order_id, client_id, number, status, client_name, order_number, device, car_number, vin, description, subtotal, total, due_date, paid_at, created_at";
const invoiceItemColumns = "id, invoice_id, service_id, service_name, price, quantity, position";

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function toInvoice(row: Record<string, unknown>): Invoice {
  const status = invoiceStatuses.has(row.status as InvoiceStatus) ? (row.status as InvoiceStatus) : "draft";
  return {
    id: String(row.id),
    invoiceNumber: text(row.number),
    clientId: text(row.client_id),
    clientName: text(row.client_name),
    ...(text(row.order_id) ? { orderId: text(row.order_id) } : {}),
    ...(text(row.order_number) ? { orderNumber: text(row.order_number) } : {}),
    amount: Number(row.total ?? 0),
    status,
    dueDate: text(row.due_date).slice(0, 10),
    createdAt: text(row.created_at).slice(0, 10),
    ...(text(row.paid_at) ? { paidAt: text(row.paid_at).slice(0, 10) } : {}),
  };
}

function toInvoiceItem(row: Record<string, unknown>): InvoiceItem {
  return {
    id: String(row.id),
    serviceId: text(row.service_id) || null,
    serviceName: text(row.service_name),
    price: Number(row.price ?? 0),
    quantity: Number(row.quantity ?? 1),
  };
}

function toInvoiceDocument(row: Record<string, unknown>, items: Record<string, unknown>[]): InvoiceDocument {
  return {
    ...toInvoice(row),
    workspaceId: text(row.workspace_id),
    device: text(row.device),
    carNumber: text(row.car_number),
    vin: text(row.vin),
    description: text(row.description),
    subtotal: Number(row.subtotal ?? 0),
    total: Number(row.total ?? 0),
    items: [...items].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0)).map(toInvoiceItem),
  };
}

/** Invoices of the workspace, newest first. Invoices still being numbered are left out. */
export async function getInvoices(workspaceId: string | undefined) {
  const targetWorkspaceId = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase.from("invoices").select(invoiceColumns).eq("workspace_id", targetWorkspaceId).order("created_at", { ascending: false });

  if (error) throw toInvoiceError(error);
  return ((data ?? []) as Record<string, unknown>[]).filter((row) => !text(row.number).startsWith(pendingNumberPrefix)).map(toInvoice);
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
  if (!data) throw new Error(invoicePermissionMessage);
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
  if (!order) throw new Error("Order was not found in this workspace.");

  const { data: lines, error: linesError } = await supabase.from("order_services").select("service_id, service_name, price, quantity").eq("order_id", orderId).order("created_at", { ascending: true });

  if (linesError) throw new Error(linesError.message);
  if (!lines || lines.length === 0) throw new Error("This order has no services to invoice.");

  const items = (lines as Record<string, unknown>[]).map((line, index) => ({
    service_id: text(line.service_id) || null,
    service_name: text(line.service_name),
    price: Number(line.price ?? 0),
    quantity: Number(line.quantity ?? 1),
    position: index,
  }));
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
