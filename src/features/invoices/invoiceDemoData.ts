import type { Invoice } from "../../lib/types";
import type { InvoiceClientOption, InvoiceOrderOption } from "./invoiceTypes";

// Sample records for UI development only. Clients and orders here are demo references, not
// Supabase rows, so invoices never point at real workspace data.
export const demoInvoiceClients: InvoiceClientOption[] = [
  { id: "demo-client-1", name: "Sarah Mitchell" },
  { id: "demo-client-2", name: "Michael Chen" },
  { id: "demo-client-4", name: "David Kim" },
  { id: "demo-client-5", name: "Jessica Thompson" },
  { id: "demo-client-6", name: "Robert Williams" },
  { id: "demo-client-7", name: "Amanda Foster" },
  { id: "demo-client-9", name: "Lisa Chang" },
];

export const demoInvoiceOrders: InvoiceOrderOption[] = [
  { id: "demo-order-1", clientId: "demo-client-1", orderNumber: "ORD-2024-001", device: "iPhone 14 Pro", totalPrice: 299, isPaid: false },
  { id: "demo-order-2", clientId: "demo-client-2", orderNumber: "ORD-2024-002", device: "MacBook Air M2", totalPrice: 199, isPaid: false },
  { id: "demo-order-4", clientId: "demo-client-4", orderNumber: "ORD-2024-004", device: "iPad Pro 12.9", totalPrice: 449, isPaid: true },
  { id: "demo-order-5", clientId: "demo-client-5", orderNumber: "ORD-2024-005", device: "Dell XPS 15", totalPrice: 149, isPaid: true },
  { id: "demo-order-9", clientId: "demo-client-9", orderNumber: "ORD-2024-009", device: "MacBook Pro 14", totalPrice: 49, isPaid: true },
  { id: "demo-order-11", clientId: "demo-client-1", orderNumber: "ORD-2024-011", device: "Apple Watch Series 8", totalPrice: 179, isPaid: true },
  { id: "demo-order-12", clientId: "demo-client-6", orderNumber: "ORD-2024-012", device: "Samsung Galaxy S23", totalPrice: 229, isPaid: false },
  { id: "demo-order-13", clientId: "demo-client-7", orderNumber: "ORD-2024-013", device: "Lenovo ThinkPad X1", totalPrice: 389, isPaid: false },
];

export const demoInvoices: Invoice[] = [
  { id: "demo-inv-1", invoiceNumber: "INV-2024-001", clientId: "demo-client-4", clientName: "David Kim", orderId: "demo-order-4", orderNumber: "ORD-2024-004", amount: 449, status: "paid", dueDate: "2024-07-15", createdAt: "2024-07-02", paidAt: "2024-07-02" },
  { id: "demo-inv-2", invoiceNumber: "INV-2024-002", clientId: "demo-client-5", clientName: "Jessica Thompson", orderId: "demo-order-5", orderNumber: "ORD-2024-005", amount: 149, status: "paid", dueDate: "2024-07-10", createdAt: "2024-06-30", paidAt: "2024-06-30" },
  { id: "demo-inv-3", invoiceNumber: "INV-2024-003", clientId: "demo-client-1", clientName: "Sarah Mitchell", orderId: "demo-order-1", orderNumber: "ORD-2024-001", amount: 299, status: "sent", dueDate: "2024-07-15", createdAt: "2024-07-01" },
  { id: "demo-inv-4", invoiceNumber: "INV-2024-004", clientId: "demo-client-2", clientName: "Michael Chen", orderId: "demo-order-2", orderNumber: "ORD-2024-002", amount: 199, status: "sent", dueDate: "2024-07-18", createdAt: "2024-07-01" },
  { id: "demo-inv-5", invoiceNumber: "INV-2024-005", clientId: "demo-client-6", clientName: "Robert Williams", amount: 500, status: "overdue", dueDate: "2024-06-25", createdAt: "2024-06-15" },
  { id: "demo-inv-6", invoiceNumber: "INV-2024-006", clientId: "demo-client-1", clientName: "Sarah Mitchell", orderId: "demo-order-11", orderNumber: "ORD-2024-011", amount: 179, status: "paid", dueDate: "2024-07-10", createdAt: "2024-07-01", paidAt: "2024-07-01" },
  { id: "demo-inv-7", invoiceNumber: "INV-2024-007", clientId: "demo-client-9", clientName: "Lisa Chang", orderId: "demo-order-9", orderNumber: "ORD-2024-009", amount: 49, status: "paid", dueDate: "2024-07-12", createdAt: "2024-07-02", paidAt: "2024-07-03" },
  { id: "demo-inv-8", invoiceNumber: "INV-2024-008", clientId: "demo-client-7", clientName: "Amanda Foster", amount: 249, status: "draft", dueDate: "2024-07-20", createdAt: "2024-07-03" },
];
