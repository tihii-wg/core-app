import type { Invoice } from "../../lib/types";
import { createDemoStore, simulateDemoLatency } from "../demo/dataSource";
import { demoInvoiceClients, demoInvoiceOrders, demoInvoices } from "./invoiceDemoData";
import type { NewInvoice } from "./invoiceTypes";

export const demoInvoiceStore = createDemoStore<Invoice[]>(demoInvoices);

function nextInvoiceNumber(invoices: Invoice[]) {
  return `INV-2024-${String(invoices.length + 1).padStart(3, "0")}`;
}

export async function createDemoInvoice(input: NewInvoice) {
  await simulateDemoLatency();
  const client = demoInvoiceClients.find((item) => item.id === input.clientId);
  const order = input.orderId ? demoInvoiceOrders.find((item) => item.id === input.orderId) : undefined;
  demoInvoiceStore.update((invoices) => [
    {
      id: `demo-inv-${Date.now()}`,
      invoiceNumber: nextInvoiceNumber(invoices),
      clientId: input.clientId,
      clientName: client?.name ?? "",
      orderId: order?.id,
      orderNumber: order?.orderNumber,
      amount: input.amount,
      status: input.status,
      dueDate: input.dueDate,
      createdAt: new Date().toISOString().split("T")[0],
    },
    ...invoices,
  ]);
}

export async function markDemoInvoicePaid(invoiceId: string) {
  const paidAt = new Date().toISOString().split("T")[0];
  demoInvoiceStore.update((invoices) => invoices.map((invoice) => (invoice.id === invoiceId ? { ...invoice, status: "paid", paidAt } : invoice)));
}
