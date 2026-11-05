// Core App Types

export type OrderStatus = "new" | "in-progress" | "waiting-parts" | "completed" | "paid" | "cancelled" | "closed";

export type PaymentStatus = "unpaid" | "partial" | "paid";

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "erroneous";

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
  middleName?: string | null;
  phoneNotificationsConsent?: boolean;
  emailNotificationsConsent?: boolean;
}

/** Per-vehicle odometer unit. Null/unknown when not set or column not applied yet. */
export type MileageUnit = "km" | "mi";

/** Client-owned vehicle (public.vehicles). Soft-deleted via deleted_at. */
export type Vehicle = {
  id: string;
  workspaceId: string;
  clientId: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  licensePlate: string | null;
  initialMileage: number | null;
  currentMileage: number | null;
  /** Odometer unit for this vehicle. Null when unset or when DB column is absent. */
  mileageUnit: MileageUnit | null;
  engineDisplacement: number | null;
  fuelType: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type VehicleInput = {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  vin?: string | null;
  licensePlate?: string | null;
  initialMileage?: number | null;
  currentMileage?: number | null;
  mileageUnit?: MileageUnit | null;
  engineDisplacement?: number | null;
  fuelType?: string | null;
};

export interface Order {
  id: string;
  workspace_id?: string;
  /** Empty string when client_id is NULL (draft without client). */
  clientId: string;
  clientName: string;
  clientType?: ClientType | null;
  /** Optional legacy field; client email is not shown in the UI. */
  clientEmail?: string;
  /** Present when the orders query embeds clients.phone. */
  clientPhone?: string;
  /** Empty string when number is NULL (unexpected; create still assigns a number). */
  orderNumber: string;
  /** Linked public.vehicles.id when set. */
  vehicleId?: string | null;
  /**
   * Visit odometer reading captured on this order (historical).
   * Null when never recorded or when the DB snapshot column is absent.
   */
  vehicleMileageSnapshot?: number | null;
  /**
   * Mileage unit at the time the visit reading was saved (`km` | `mi`).
   * Null = unknown legacy; never inferred from the vehicle's current unit.
   */
  vehicleMileageUnitSnapshot?: MileageUnit | null;
  device: string;
  vin: string;
  carNumber: string;
  service: string;
  services: OrderService[];
  /** Absent on legacy fixtures; treat as []. */
  materials?: OrderMaterial[];
  description: string;
  status: OrderStatus;
  /** Nullable FK to status_definitions when custom statuses are enabled. */
  customStatusId?: string | null;
  /** Resolved status_definitions row for badge display. */
  customStatus?: { name: string; color: string | null } | null;
  /**
   * Formal closure timestamp (`orders.closed_at`). Set only by close RPC.
   * Null when never formally closed. Refunds after close do not clear this.
   */
  closedAt?: string | null;
  /**
   * When set, this order is a warranty claim linked to the original closed order
   * (`orders.warranty_source_order_id`). Null/absent = ordinary order.
   */
  warrantySourceOrderId?: string | null;
  /** employees.id from orders.employee_id (legacy assigned_to only when employee_id is empty). */
  assignedEmployeeId: string;
  assignedEmployeeName: string;
  deadline: string;
  /** Final (net) amount = subtotal - discountTotal; what `orders.total_price` stores. */
  totalPrice: number;
  /** Sum of line gross amounts (price * qty). Falls back to totalPrice + discountTotal when lines are not loaded. */
  subtotal?: number;
  /** `orders.discount_total` (crm_ro_v1); 0 when absent. */
  discountTotal?: number;
  /** Header `orders.discount_type` / `discount_value` (20261101060000); set only for a single uniform percent. */
  discountType?: "percent" | "amount" | null;
  discountValue?: number | null;
  isPaid: boolean;
  paymentStatus: PaymentStatus;
  /** Tax (fiscal) invoice number from orders.tax_invoice_number; absent on legacy fixtures — treat as "". Not the app invoice number. */
  taxInvoiceNumber?: string;
  /** auth.users id from orders.created_by when present. */
  createdById?: string;
  /** Workspace member display name for created_by (full name or email). */
  createdByName?: string;
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
  vehicleId: string;
  device: string;
  vin: string;
  carNumber: string;
  /** Visit mileage for the linked vehicle; persisted to vehicles.current_mileage, not orders. */
  currentMileage: string;
  description: string;
  services: OrderService[];
  materials: OrderMaterial[];
  assignedEmployeeId: string;
  deadline: string;
  status: OrderStatus;
  isPaid: boolean;
}

export type CreateOrderInput = {
  clientId?: string;
  /** When empty and no clientId, order is saved with client_id NULL. */
  clientName?: string;
  clientType?: ClientType;
  clientTaxId?: string;
  clientContactPerson?: string;
  clientEmail?: string;
  clientPhone?: string;
  vehicleId?: string | null;
  device?: string;
  vin?: string;
  carNumber?: string;
  /** Historical visit mileage for this order; omit when the visit field was left empty. */
  vehicleMileageSnapshot?: number | null;
  /** Unit captured with the visit mileage; null = unknown. */
  vehicleMileageUnitSnapshot?: MileageUnit | null;
  description?: string;
  /** Empty array is allowed for draft orders. */
  services: OrderService[];
  /** When omitted or empty, the order is created with no material lines. */
  materials?: OrderMaterial[];
  assignedEmployeeId?: string;
  deadline?: string;
};

export type UpdateOrderInput = CreateOrderInput & {
  orderId: string;
  status: OrderStatus;
  isPaid: boolean;
};

export type EditOrderFormData = {
  /** Empty string clears the vehicle; omit on partial updates to leave vehicle_id unchanged. */
  vehicleId?: string;
  device: string;
  carNumber: string;
  vin: string;
  /**
   * Visit mileage form field. Also updates vehicles.current_mileage when changed.
   * Order historical snapshot is written only when this field is dirty on save.
   */
  currentMileage?: string;
  description: string;
  assignedEmployeeId: string;
  deadline: string;
  services: OrderService[];
  materials: OrderMaterial[];
};

export type UpdateOrderDetails = Omit<EditOrderFormData, "services" | "materials"> & {
  orderId: string;
  /** The order's complete final service list; omit to leave the saved lines untouched. Empty array clears lines when supported. */
  services?: OrderService[];
  /** The order's complete final material list; omit to leave saved materials untouched. Empty array removes all materials and restores stock. */
  materials?: OrderMaterial[];
  /**
   * Omit to leave historical mileage snapshots unchanged.
   * When set, both value and unit are written together.
   */
  vehicleMileageSnapshot?: number | null;
  vehicleMileageUnitSnapshot?: MileageUnit | null;
};
/** Catalog default warranty mode stored on services / inventory_items. */
export type CatalogWarrantyType = "none" | "duration" | "mileage" | "both";

export interface addNewServiceFormData {
  serviceId?: string;
  serviceName: string;
  status: string;
  category?: serviceCategory | "";
  price: number | undefined;
  description?: string;
  /** null = unconfigured (legacy). Explicit none/duration/mileage/both when set. */
  warrantyType?: CatalogWarrantyType | null;
  warrantyMonths?: number | null;
  warrantyKm?: number | null;
}

export type EditServiceFormData = {
  serviceName: string;
  status: string;
  category: serviceCategory | "";
  price: number | undefined;
  description: string;
  warrantyType?: CatalogWarrantyType | null;
  warrantyMonths?: number | null;
  warrantyKm?: number | null;
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
  /** null = unconfigured → workspace defaults when added to an order. */
  warrantyType?: CatalogWarrantyType | null;
  warrantyMonths?: number | null;
  warrantyKm?: number | null;
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
  warrantyType?: CatalogWarrantyType | null;
  warrantyMonths?: number | null;
  warrantyKm?: number | null;
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
  /** null = unconfigured → workspace defaults when added to an order. */
  warrantyType?: CatalogWarrantyType | null;
  warrantyMonths?: number | null;
  warrantyKm?: number | null;
}

/** List/detail invoice fields aligned with public.invoices. */
export interface Invoice {
  id: string;
  workspaceId: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  /** Live clients.phone for the linked client when available. */
  clientPhone?: string;
  orderId?: string;
  orderNumber?: string;
  device: string;
  carNumber: string;
  vin: string;
  description: string;
  subtotal: number;
  /** Same as total — kept for list/summary call sites. */
  amount: number;
  total: number;
  status: InvoiceStatus;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
  /** auth.users id from invoices.created_by when present. */
  createdById?: string;
  /** Workspace member display name for created_by. */
  createdByName?: string;
}

/** A copy of one order line, frozen on the invoice when it is created (matches public.invoice_items). */
export type InvoiceItem = {
  id: string;
  invoiceId: string;
  serviceId: string | null;
  serviceName: string;
  price: number;
  quantity: number;
  /** 0-based line order from invoice_items.position. */
  position: number;
  createdAt: string;
};

/** A saved invoice with the order details and lines it copied when it was created. */
export interface InvoiceDocument extends Invoice {
  items: InvoiceItem[];
}

// Mirrors expenses_payment_method_check in supabase/migrations/20261005020000_expenses.sql.
export const paymentMethods = ["cash", "card", "bank-transfer", "other"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export interface Expense {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
}

export type ExpenseFormData = Omit<Expense, "id">;

/** One Finance row: ledger payment/refund or a recorded expense. */
export interface Transaction {
  id: string;
  type: "income" | "expense" | "refund";
  category: string;
  description: string;
  amount: number;
  paymentMethod?: PaymentMethod;
  date: string;
  relatedOrderId?: string;
  relatedInvoiceId?: string;
  expense?: Expense;
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
  | "dashboard"
  | "orders"
  | "clients"
  | "employees"
  | "inventory"
  | "warehouses"
  | "services"
  | "invoices"
  | "finance"
  | "reports"
  | "settings";

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

/** `order_services.kind` (crm_ro_v1 / 20261101050000_order_line_kind): labor line vs. service line. */
export type OrderServiceKind = "labor" | "service";

export type OrderService = {
  /** order_services.id; absent for a line that has not been saved yet. */
  id?: string;
  serviceId: string;
  serviceName: string;
  price: number;
  quantity: number;
  /**
   * Optional line kind. `undefined` = not managed by the caller (stored value is kept),
   * `null` = explicitly unclassified. Ignored when the column is absent in the database.
   */
  kind?: OrderServiceKind | null;
  /** `order_services.discount_type` / `discount_value` (crm_ro_v1). Absent when the columns do not exist. */
  discountType?: "percent" | "amount" | null;
  discountValue?: number | null;
  /** Calendar months of warranty coverage. Null/absent = no duration limit (or column missing). */
  warrantyMonths?: number | null;
  /** Exact calendar days when the line uses day-based warranty (not months). */
  warrantyDays?: number | null;
  /** Mileage allowance from warranty start. Null/absent = no mileage limit (or column missing). */
  warrantyKm?: number | null;
};

/** How an order material line is sourced. Catalog lines link to inventory_items; others are order-only snapshots. */
export type OrderMaterialSupplySource = "catalog" | "one_time" | "customer";

export type OrderMaterial = {
  /** order_materials.id; absent for a line that has not been saved yet. */
  id?: string;
  /**
   * Catalog inventory item id. Empty/absent for one-time and customer-supplied lines
   * (requires nullable order_materials.inventory_item_id on the database).
   */
  inventoryItemId?: string;
  itemName: string;
  price: number;
  /** Requested quantity (planning). Does not change warehouse stock by itself. */
  quantity: number;
  /** Cumulative quantity issued from the warehouse. */
  quantityIssued?: number;
  /** Cumulative quantity returned to the warehouse. */
  quantityReturned?: number;
  /**
   * Warehouse used for immediate catalog issue / return (client + optional order_materials.warehouse_id).
   * Required when adding or increasing a catalog line under warehouse-first rules.
   */
  warehouseId?: string;
  /** catalog (default) | one_time | customer. Absent when column not applied yet. */
  supplySource?: OrderMaterialSupplySource;
  /** `order_materials.discount_type` / `discount_value` (crm_ro_v1). Absent when the columns do not exist. */
  discountType?: "percent" | "amount" | null;
  discountValue?: number | null;
  /** Calendar months of warranty coverage. Null/absent = no duration limit (or column missing). */
  warrantyMonths?: number | null;
  /** Exact calendar days when the line uses day-based warranty (not months). */
  warrantyDays?: number | null;
  /** Mileage allowance from warranty start. Null/absent = no mileage limit (or column missing). */
  warrantyKm?: number | null;
};

export type InventoryMovementType = "issue" | "return" | "adjustment";

export type InventoryMovement = {
  id: string;
  workspaceId: string;
  inventoryItemId: string;
  orderId: string | null;
  orderMaterialId: string | null;
  /** Present when inventory_movements.warehouse_id exists (crm_ro_v1). */
  warehouseId: string | null;
  movementType: InventoryMovementType;
  quantity: number;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type WarehouseMaterialLineInput = {
  inventoryItemId: string;
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
  middleName?: string;
  taxId: string;
  contactPerson: string;
  phone: string;
  address?: string;
  notes?: string;
  phoneNotificationsConsent?: boolean;
  emailNotificationsConsent?: boolean;
};

export type AddNewClientFormData = ClientFormValues & {
  workspace_id: string;
  balance?: number;
};

export type CreateClientInput = {
  workspace_id: string;
  clientName: string;
  phone: string;
  address?: string;
  notes?: string;
  clientType?: ClientType;
  taxId?: string | null;
  contactPerson?: string | null;
  middleName?: string | null;
  phoneNotificationsConsent?: boolean;
  emailNotificationsConsent?: boolean;
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
};

export type CreateEmployeeData = AddNewEmployeesFormData & {
  workspace_id: string;
  profile_id: string | null;
};

/** Editable employee fields. Does not include workspace_id, profile_id, or email. */
export type EditEmployeeFormData = {
  name: string;
  phone: string;
  role: EmployeeRole;
  status: "active" | "inactive";
};

export type UpdateEmployeeInput = EditEmployeeFormData & {
  employeeId: string;
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
