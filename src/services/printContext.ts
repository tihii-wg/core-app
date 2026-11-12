import type { Client, InvoiceDocument, Order, Vehicle } from "../lib/types";
import type { DocumentTemplateType } from "../features/documents/layout";
import type { PrintContext } from "../features/documents/templateVariables";
import { emptyPrintContext } from "../features/documents/templateVariables";
import { invoicePaymentBalance, orderPaymentBalance } from "../features/finance/paymentCalculations";
import { allocatePaid, type AllocatedPaymentStage } from "../features/finance/paymentStages";
import { classifyInvoiceItems, type InvoiceOrderLines } from "../features/invoices/invoiceItemSections";
import { getWorkspaceLogoUrl } from "../features/workspaces/workspaceAvatar";
import { getClient } from "./apiClients";
import {
  displayCustomFieldValue,
  getCustomFieldValuesForEntity,
  getOrderFieldDefinitions,
} from "./apiCustomFields";
import { getInvoice, getInvoices } from "./apiInvoices";
import { getLegalEntities, type LegalEntity } from "./apiLegalEntities";
import { getOrder } from "./apiOrders";
import { getPayments } from "./apiPayments";
import { getOrderPaymentStages } from "./apiPaymentStages";
import { getVehicle } from "./apiVehicles";
import { getInvoiceTaxTotal } from "./apiInvoiceTax";
import { getWarrantyRecordsForOrder } from "./apiWarranty";
import { getWorkspaceVatRate } from "./apiWorkspaceVat";
import { getWorkspace, type WorkspaceDetails } from "./apiWorkspaces";
import { getLocations, pickPrintCompanyPhone } from "./apiLocations";
import { requireWorkspaceId } from "./missingTable";
import { industryProfile } from "../features/industries/industryProfile";
import { industryWorkflow } from "../features/industries/industryWorkflow";
import { mergeOrderFieldConfig } from "../features/orders/orderFieldConfig";
import { stripOrderLineComments } from "../features/orders/orderLineComments";

async function soft<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

/** Private line comments must never reach a printed document, even for the owner. */
function orderForPrint(order: Order, workspace: WorkspaceDetails | null | undefined): Order {
  if (workspace?.lineCommentsVisibility === "public") return order;
  return stripOrderLineComments(order);
}

/** Loads order stages (soft: missing table / errors → null) and allocates the net paid amount across them. */
async function loadAllocatedStages(
  orderId: string,
  workspaceId: string,
  orderTotal: number,
  netPaid: number,
): Promise<AllocatedPaymentStage[] | null> {
  const stages = await soft(getOrderPaymentStages(orderId, workspaceId), []);
  if (stages.length === 0) return null;
  return allocatePaid(stages, orderTotal, netPaid);
}

function pickLegalEntity(entities: LegalEntity[], workspace: WorkspaceDetails | null): LegalEntity | null {
  if (entities.length === 0) return null;
  const preferredId = workspace?.defaultLegalEntityId;
  if (preferredId) {
    const preferred = entities.find((entity) => entity.id === preferredId);
    if (preferred) return preferred;
  }
  return entities.find((entity) => entity.isDefault) ?? entities[0] ?? null;
}

async function workspacePrintBase(resolved: string) {
  const [workspace, legalEntities, locations] = await Promise.all([
    soft(getWorkspace(resolved), null),
    soft(getLegalEntities(resolved), [] as LegalEntity[]),
    soft(getLocations(resolved), []),
  ]);
  const logoUrl =
    workspace?.avatarPath
      ? await soft(getWorkspaceLogoUrl(resolved, workspace.avatarPath), null)
      : null;
  const legalEntity = pickLegalEntity(legalEntities, workspace);
  return {
    workspace,
    legalEntity,
    logoUrl,
    companyPhone: pickPrintCompanyPhone(locations),
    currency: workspace?.currency?.trim() || "",
    dateFormat: workspace?.dateFormat?.trim() || "DD.MM.YYYY",
    timeZone: workspace?.timezone?.trim() || "Europe/Chisinau",
    locale: workspace?.documentLanguage?.trim() || workspace?.language?.trim() || "en",
  };
}

/**
 * Loads everything needed to resolve print-template variables for one order.
 * Soft-fails missing optional tables (vehicles, legal entities, warranty, payments, logo).
 */
export async function buildOrderPrintContext(
  orderId: string,
  workspaceId: string | undefined,
  documentKind: DocumentTemplateType = "work_order",
): Promise<PrintContext> {
  const resolved = requireWorkspaceId(workspaceId);
  const loadedOrder = await getOrder(orderId, resolved);

  const [base, client, vehicle, payments, warrantyRecords, workspaceVatRate, definitions, customValues] = await Promise.all([
    workspacePrintBase(resolved),
    loadedOrder.clientId ? soft(getClient(resolved, loadedOrder.clientId), null) : Promise.resolve(null as Client | null),
    loadedOrder.vehicleId ? soft(getVehicle(resolved, loadedOrder.vehicleId), null) : Promise.resolve(null as Vehicle | null),
    soft(getPayments(resolved, { orderId: loadedOrder.id }), []),
    soft(getWarrantyRecordsForOrder(resolved, loadedOrder.id), []),
    soft(getWorkspaceVatRate(resolved), null),
    soft(getOrderFieldDefinitions(resolved), []),
    soft(getCustomFieldValuesForEntity(resolved, loadedOrder.id), []),
  ]);

  const order = orderForPrint(loadedOrder, base.workspace);
  const paymentBalance = orderPaymentBalance(order, payments);
  const paymentStages = await loadAllocatedStages(order.id, resolved, order.totalPrice, paymentBalance.netPaid);

  const profile = industryProfile(base.workspace?.industrySlug);
  const workflow = industryWorkflow(profile.slug);
  const { fields: mergedFields } = mergeOrderFieldConfig({ profile, workflow, definitions });
  const customFieldValues: Record<string, string> = {};
  const orderFieldLabels: Record<string, string> = {};
  for (const field of mergedFields) {
    if (!field.visible) continue;
    orderFieldLabels[field.key] = field.label;
    if (!field.isCustom || !field.definitionId) continue;
    const row = customValues.find((value) => value.definitionId === field.definitionId);
    customFieldValues[field.key] = displayCustomFieldValue(field.type, row?.value, field.options);
  }

  return emptyPrintContext({
    order,
    invoice: null,
    invoiceSections: null,
    client,
    vehicle,
    workspace: base.workspace,
    legalEntity: base.legalEntity,
    logoUrl: base.logoUrl,
    companyPhone: base.companyPhone,
    currency: base.currency,
    dateFormat: base.dateFormat,
    timeZone: base.timeZone,
    locale: base.locale,
    paymentBalance,
    paymentStages,
    warrantyRecords,
    printedAt: new Date(),
    documentKind: documentKind === "invoice" ? "work_order" : documentKind,
    workspaceVatRate,
    invoiceTaxTotal: null,
    customFieldValues,
    orderFieldLabels,
  });
}

/**
 * Invoice print context: invoice + lines, client, linked order/vehicle when present,
 * company (workspace/legal entity), and payment balance.
 */
export async function buildInvoicePrintContext(invoiceId: string, workspaceId: string | undefined): Promise<PrintContext> {
  const resolved = requireWorkspaceId(workspaceId);
  const invoice = await getInvoice(invoiceId, resolved);

  const [base, client, loadedOrder, payments, workspaceVatRate, invoiceTaxTotal] = await Promise.all([
    workspacePrintBase(resolved),
    invoice.clientId ? soft(getClient(resolved, invoice.clientId), null) : Promise.resolve(null as Client | null),
    invoice.orderId ? soft(getOrder(invoice.orderId, resolved), null) : Promise.resolve(null as Order | null),
    soft(getPayments(resolved, { invoiceId: invoice.id }), []),
    soft(getWorkspaceVatRate(resolved), null),
    soft(getInvoiceTaxTotal(invoice.id, resolved), null),
  ]);

  const order = loadedOrder ? orderForPrint(loadedOrder, base.workspace) : null;
  const vehicle =
    order?.vehicleId != null
      ? await soft(getVehicle(resolved, order.vehicleId), null)
      : null;
  const warrantyRecords =
    order != null ? await soft(getWarrantyRecordsForOrder(resolved, order.id), []) : [];
  const paymentBalance = invoicePaymentBalance(invoice, payments);
  let paymentStages: AllocatedPaymentStage[] | null = null;
  if (order) {
    // Order-level net paid (order + invoice-linked ledger rows), not the invoice-only balance.
    const orderPayments = await soft(getPayments(resolved, { orderId: order.id }), []);
    const orderBalance = orderPaymentBalance(order, [...orderPayments, ...payments], invoice.id);
    paymentStages = await loadAllocatedStages(order.id, resolved, order.totalPrice, orderBalance.netPaid);
  }
  const orderLines: InvoiceOrderLines | null = order
    ? {
        services: (order.services ?? []).map((line) => ({
          serviceId: line.serviceId || null,
          serviceName: line.serviceName,
          price: line.price,
          quantity: line.quantity,
        })),
        materials: (order.materials ?? []).map((line) => ({
          itemName: line.itemName,
          price: line.price,
          quantity: line.quantity,
        })),
      }
    : null;
  const invoiceSections = classifyInvoiceItems(invoice.items ?? [], orderLines);

  return emptyPrintContext({
    order,
    invoice,
    invoiceSections,
    client,
    vehicle,
    workspace: base.workspace,
    legalEntity: base.legalEntity,
    logoUrl: base.logoUrl,
    companyPhone: base.companyPhone,
    currency: base.currency,
    dateFormat: base.dateFormat,
    timeZone: base.timeZone,
    locale: base.locale,
    paymentBalance,
    paymentStages,
    warrantyRecords,
    printedAt: new Date(),
    documentKind: "invoice",
    workspaceVatRate,
    invoiceTaxTotal,
  });
}

/** Recent orders for the print-template preview picker (newest first). */
export async function listRecentOrdersForPrintPreview(workspaceId: string | undefined, limit = 20): Promise<Order[]> {
  const { getOrders } = await import("./apiOrders");
  const orders = await getOrders(workspaceId);
  return orders.slice(0, Math.max(1, Math.min(limit, 50)));
}

/** Recent invoices for invoice-template preview. */
export async function listRecentInvoicesForPrintPreview(
  workspaceId: string | undefined,
  limit = 20,
): Promise<InvoiceDocument[]> {
  const invoices = await soft(getInvoices(workspaceId), []);
  const slice = invoices.slice(0, Math.max(1, Math.min(limit, 50)));
  // List rows lack items; load full documents for the first few when preview needs lines.
  const docs = await Promise.all(slice.map((invoice) => soft(getInvoice(invoice.id, workspaceId), null)));
  return docs.filter((doc): doc is InvoiceDocument => doc != null);
}
