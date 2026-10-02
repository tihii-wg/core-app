import type { Invoice } from "../../lib/types";
import { useDemoStore, type DataSourceResult } from "../demo/dataSource";
import { demoInvoiceClients, demoInvoiceOrders } from "./invoiceDemoData";
import { createDemoInvoice, demoInvoiceStore, markDemoInvoicePaid } from "./invoiceDemoSource";
import type { InvoiceClientOption, InvoiceOrderOption, NewInvoice } from "./invoiceTypes";

// The Invoices UI reads and writes only through these hooks. When the invoice schema is final,
// replace their bodies with workspace-scoped Supabase queries/mutations and return `isDemo: false`.

export function useInvoices(): DataSourceResult<Invoice[]> {
  const invoices = useDemoStore(demoInvoiceStore);
  return { data: invoices, isLoading: false, error: null, isDemo: true };
}

export function useInvoiceFormOptions(): DataSourceResult<{ clients: InvoiceClientOption[]; orders: InvoiceOrderOption[] }> {
  return { data: { clients: demoInvoiceClients, orders: demoInvoiceOrders }, isLoading: false, error: null, isDemo: true };
}

export function useInvoiceActions(): {
  createInvoice: (input: NewInvoice) => Promise<void>;
  markInvoicePaid: (invoiceId: string) => Promise<void>;
} {
  return { createInvoice: createDemoInvoice, markInvoicePaid: markDemoInvoicePaid };
}
