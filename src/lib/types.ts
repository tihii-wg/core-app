// Core App Types

import type React from "react";

export type OrderStatus = "new" | "in-progress" | "waiting-parts" | "completed" | "paid" | "cancelled";

export type PaymentStatus = "unpaid" | "partial" | "paid";

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

export type EmployeeRole = "admin" | "manager" | "technician" | "receptionist";

export type serviceCategory = "repair" | "software" | "update" | "data" | "assesment";

export type EmployeeRoleOption = {
  value: EmployeeRole;
  label: string;
};

export interface User {
  id: string;
  email: string;
  name: string;
  companyName: string;
  role: EmployeeRole;
  avatar?: string;
}

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  balance: number;
  created_at: string;
  notes?: string;
}

export interface Order {
  id: string;
  workspace_id?: string;
  clientId: string;
  clientName: string;
  orderNumber: string;
  device: string;
  vin: string;
  service: string;
  services: OrderService[];
  description: string;
  status: OrderStatus;
  assignedEmployeeId: string;
  assignedEmployeeName: string;
  deadline: string;
  totalPrice: number;
  isPaid: boolean;
  paymentStatus: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: EmployeeRole;
  avatar?: string;
  assignedTasks: number;
  completedTasks: number;
  status: "active" | "inactive";
}

export interface addNewOrderFormData {
  clientId: string;
  device: string;
  vin: string;
  description: string;
  services: OrderService[];
  assignedEmployeeId: string;
  deadline: string;
  status: OrderStatus;
  isPaid: boolean;
}

export type CreateOrderInput = {
  clientId?: string;
  clientName: string;
  device: string;
  vin?: string;
  description?: string;
  services: OrderService[];
  assignedEmployeeId: string;
  deadline?: string;
};

export type UpdateOrderInput = CreateOrderInput & {
  orderId: string;
  status: OrderStatus;
  isPaid: boolean;
};
export interface addNewServiceFormData {
  serviceId?: string;
  serviceName: string;
  status: string;
  price: number | undefined;
  description?: string;
}

export type EditServiceFormData = {
  serviceName: string;
  status: string;
  price: number | undefined;
  description: string;
};

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  supplier: string;
  quantity: number;
  minQuantity: number;
  purchasePrice: number;
  salePrice: number;
  status: "in-stock" | "low-stock" | "out-of-stock";
}

export interface Service {
  id: string;
  service_name: string;
  category: string;
  duration: number; // in minutes
  service_price: number;
  description: string;
  status: "active" | "inactive";
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  orderId?: string;
  orderNumber?: string;
  amount: number;
  status: InvoiceStatus;
  dueDate: string;
  createdAt: string;
  paidAt?: string;
}

export interface Transaction {
  id: string;
  type: "income" | "expense";
  category: string;
  description: string;
  amount: number;
  paymentMethod: "cash" | "card" | "bank-transfer" | "other";
  date: string;
  relatedOrderId?: string;
  relatedInvoiceId?: string;
}

export interface DashboardStats {
  activeOrders: number;
  todayRevenue: number;
  unpaidInvoices: number;
  lowStockItems: number;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
}

export type AppModule = "dashboard" | "orders" | "clients" | "employees" | "inventory" | "services" | "invoices" | "finance" | "reports" | "settings";

export type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  deleted_at: string | null;
};

export type WorkspaceMemberWithWorkspace = {
  role: "owner" | "manager" | "member";
  workspaces: Workspace | null;
};

export type WorkspaceMember = {
  user_id: string;
  workspace_id: string;
  role: "owner" | "manager" | "member";
};

export type IndustryKey = "restaurant" | "beauty" | "fitness" | "medical" | "retail" | "professional_services" | "auto_service" | "electronics_repair";

export type Profile = {
  id: string;
  email: string;
  fullName: string | null;
  preferredLanguage?: string;
};

export type OrderService = {
  serviceId: string;
  serviceName: string;
  price: number;
  quantity: number;
};

export type Company = {
  id: string;
  ownerUserId: string;
  name: string | null;
  industry: IndustryKey;
};

export type AddNewClientFormData = {
  workspace_id: string;
  clientName: string;
  email: string;
  phone: string;
  address?: string;
  notes?: string;
  balance?: number;
  // search?: string;
};

export type EditClientFormData = {
  clientName: string;
  email: string;
  phone: string;
  address?: string;
  notes?: string;
};

export type UpdateClientInput = EditClientFormData & {
  clientId: string;
};

export type AddNewEmployeesFormData = {
  workspace_id?: string;
  profile_id?: string;
  name: string;
  role: EmployeeRole | "";
  status: string;
  phone: string;
  email: string;
};

export type CreateEmployeeData = AddNewEmployeesFormData & {
  workspace_id: string;
  profile_id: string;
};

export type NewWorkspaceData = {
  name: string;
  role: string;
  userId: string;
};

export type CreateMadalProps = {
  // search?: string;
  setCreateModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
};
