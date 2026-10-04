// Core App Types

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

export type ClientType = "individual" | "organization";

export type ClientListFilter = "all" | ClientType;

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  balance: number;
  created_at: string;
  notes?: string;
  client_type: ClientType | null;
  tax_id: string | null;
  contact_person: string | null;
}

export interface Order {
  id: string;
  workspace_id?: string;
  clientId: string;
  clientName: string;
  clientType?: ClientType | null;
  orderNumber: string;
  device: string;
  vin: string;
  carNumber: string;
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
  profile_id?: string | null;
}

export interface addNewOrderFormData {
  clientId: string;
  newClientType?: ClientType;
  newClientTaxId?: string;
  newClientContactPerson?: string;
  newClientEmail?: string;
  newClientPhone?: string;
  device: string;
  vin: string;
  carNumber: string;
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
  clientType?: ClientType;
  clientTaxId?: string;
  clientContactPerson?: string;
  clientEmail?: string;
  clientPhone?: string;
  device: string;
  vin?: string;
  carNumber?: string;
  description?: string;
  services: OrderService[];
  assignedEmployeeId?: string;
  deadline?: string;
};

export type UpdateOrderInput = CreateOrderInput & {
  orderId: string;
  status: OrderStatus;
  isPaid: boolean;
};

export type EditOrderFormData = {
  device: string;
  carNumber: string;
  vin: string;
  description: string;
  assignedEmployeeId: string;
  deadline: string;
  services: OrderService[];
};

export type UpdateOrderDetails = Omit<EditOrderFormData, "services"> & {
  orderId: string;
  /** The order's complete final service list; omit to leave the saved lines untouched. */
  services?: OrderService[];
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

export type InventoryStockStatus = "in_stock" | "low_stock" | "out_of_stock";

export type InventoryListFilter = "all" | InventoryStockStatus | "inactive";

export type InventorySortField = "name" | "sku" | "quantity" | "purchase_price" | "selling_price" | "created_at" | "updated_at";

export type InventorySort = {
  field: InventorySortField;
  ascending: boolean;
};

export interface InventoryItem {
  id: string;
  workspaceId: string;
  name: string;
  sku: string;
  description: string;
  category: string;
  quantity: number;
  minQuantity: number;
  unit: string;
  purchasePrice: number | null;
  sellingPrice: number | null;
  supplier: string;
  location: string;
  isActive: boolean;
  stockStatus: InventoryStockStatus;
  createdAt: string;
  updatedAt: string;
}

export type InventoryItemFormData = {
  name: string;
  sku: string;
  description: string;
  category: string;
  quantity: number;
  minQuantity: number;
  unit: string;
  purchasePrice: number | null;
  sellingPrice: number | null;
  supplier: string;
  location: string;
  isActive: boolean;
};

export interface MockInventoryItem {
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
  industry_id: string | null;
  avatar_path?: string | null;
  inventory_markup: number | null;
  language?: string | null;
  timezone?: string | null;
  date_format?: string | null;
  currency?: string | null;
  industry: WorkspaceIndustry | null;
};

export type WorkspaceMemberWithWorkspace = {
  role: "owner" | "admin" | "manager" | "member";
  workspaces: Workspace | null;
};

export type WorkspaceMember = {
  user_id: string;
  workspace_id: string;
  role: "owner" | "admin" | "manager" | "member";
};

export type IndustryKey = "restaurant" | "beauty" | "fitness" | "medical" | "retail" | "professional_services" | "auto_service" | "electronics_repair";

export type Profile = {
  id: string;
  email: string;
  fullName: string | null;
  preferredLanguage?: string;
  theme?: "light" | "dark" | "system";
};

export type OrderService = {
  /** order_services.id; absent for a line that has not been saved yet. */
  id?: string;
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

export type ClientFormValues = {
  clientType: ClientType;
  clientName: string;
  taxId: string;
  contactPerson: string;
  email: string;
  phone: string;
  address?: string;
  notes?: string;
};

export type AddNewClientFormData = ClientFormValues & {
  workspace_id: string;
  balance?: number;
};

export type CreateClientInput = {
  workspace_id: string;
  clientName: string;
  email: string;
  phone: string;
  address?: string;
  notes?: string;
  clientType?: ClientType;
  taxId?: string | null;
  contactPerson?: string | null;
};

export type EditClientFormData = ClientFormValues;

export type UpdateClientInput = EditClientFormData & {
  clientId: string;
};

export type AddNewEmployeesFormData = {
  workspace_id?: string;
  profile_id: string | null;
  name: string;
  role: EmployeeRole | "";
  status: string;
  phone: string;
  email: string;
};

export type CreateEmployeeData = AddNewEmployeesFormData & {
  workspace_id: string;
  profile_id: string | null;
};

export type Industry = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
};

export type WorkspaceIndustry = Pick<Industry, "id" | "name" | "slug">;

export type NewWorkspaceData = {
  name: string;
  role: string;
  industryId: string;
  language?: string | null;
};

export type CreateMadalProps = {
  // search?: string;
  setCreateModalOpen: (open: boolean) => void;
};
