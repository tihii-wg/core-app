import type { InvoiceStatus } from "../../lib/types";

export type InvoiceClientOption = { id: string; name: string };

export type InvoiceOrderOption = {
  id: string;
  clientId: string;
  orderNumber: string;
  device: string;
  totalPrice: number;
  isPaid: boolean;
};

export type NewInvoice = {
  clientId: string;
  orderId?: string;
  amount: number;
  status: InvoiceStatus;
  dueDate: string;
};
