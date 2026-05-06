// Core App Types

export type OrderStatus = 'new' | 'in-progress' | 'waiting-parts' | 'completed' | 'paid' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';
export type EmployeeRole = 'admin' | 'manager' | 'technician' | 'receptionist';

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
  createdAt: string;
  notes?: string;
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
  status: 'active' | 'inactive';
}

export interface Order {
  id: string;
  orderNumber: string;
  clientId: string;
  clientName: string;
  device: string;
  service: string;
  description: string;
  status: OrderStatus;
  assignedEmployeeId: string;
  assignedEmployeeName: string;
  deadline: string;
  totalPrice: number;
  paymentStatus: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}

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
  status: 'in-stock' | 'low-stock' | 'out-of-stock';
}

export interface Service {
  id: string;
  name: string;
  category: string;
  duration: number; // in minutes
  price: number;
  description: string;
  status: 'active' | 'inactive';
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
  type: 'income' | 'expense';
  category: string;
  description: string;
  amount: number;
  paymentMethod: 'cash' | 'card' | 'bank-transfer' | 'other';
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

export type AppModule = 
  | 'dashboard'
  | 'orders'
  | 'clients'
  | 'employees'
  | 'inventory'
  | 'services'
  | 'invoices'
  | 'finance'
  | 'reports'
  | 'settings';
