/** Demo-only mock import data. Never loaded from or written to the database. */

export const IMPORT_DEMO_STEPS = [
  "type",
  "upload",
  "preview",
  "mapping",
  "validation",
  "confirm",
  "result",
] as const;

export type ImportDemoStep = (typeof IMPORT_DEMO_STEPS)[number];

export type ImportDemoDataType = "customers" | "orders" | "both";

export type CustomerDestinationField =
  | "skip"
  | "name"
  | "phone"
  | "email"
  | "address";

export type OrderDestinationField =
  | "skip"
  | "number"
  | "date"
  | "customer"
  | "description"
  | "vehicle"
  | "vin"
  | "status"
  | "total";

export type ImportDemoCustomerRow = {
  name: string;
  phone: string;
  email: string;
  address: string;
};

export type ImportDemoOrderRow = {
  number: string;
  date: string;
  customer: string;
  description: string;
  vehicle: string;
  vin: string;
  status: string;
  total: string;
};

export type ImportDemoIssueMessageKey =
  | "settings.import.validation.okRow"
  | "settings.import.validation.duplicatePhone"
  | "settings.import.validation.missingName"
  | "settings.import.validation.unmatchedCustomer";

export type ImportDemoIssue = {
  severity: "error" | "warning" | "info";
  code: "duplicate" | "missing" | "unmatched" | "ok";
  row: number;
  messageKey: ImportDemoIssueMessageKey;
  detail?: string;
};

/** Fictional customers — example.com / example.org only. */
export const MOCK_CUSTOMERS: ImportDemoCustomerRow[] = [
  {
    name: "Ana Popescu",
    phone: "+373 69 100 201",
    email: "ana.popescu@example.com",
    address: "Str. Stefan cel Mare 12, Chișinău",
  },
  {
    name: "Ion Marin",
    phone: "+373 69 100 202",
    email: "ion.marin@example.org",
    address: "Bd. Dacia 45, Chișinău",
  },
  {
    name: "Elena Rusu",
    phone: "+373 69 100 203",
    email: "elena.rusu@example.com",
    address: "Str. Puskin 8, Bălți",
  },
  {
    name: "Mihai Cojocaru",
    phone: "+373 69 100 204",
    email: "mihai.cojocaru@example.org",
    address: "Str. Independenței 3, Cahul",
  },
  {
    name: "Maria Ionescu",
    phone: "+373 69 100 205",
    email: "maria.ionescu@example.com",
    address: "Str. Bucuresti 21, Chișinău",
  },
];

/** Fictional orders — reserved demo numbers and VINs. */
export const MOCK_ORDERS: ImportDemoOrderRow[] = [
  {
    number: "ORD-DEMO-001",
    date: "2026-03-12",
    customer: "Ana Popescu",
    description: "Oil change and inspection",
    vehicle: "Dacia Logan",
    vin: "DEMO0VIN000000001",
    status: "in-progress",
    total: "1,250.00 MDL",
  },
  {
    number: "ORD-DEMO-002",
    date: "2026-03-14",
    customer: "Ion Marin",
    description: "Brake pad replacement",
    vehicle: "Volkswagen Golf",
    vin: "DEMO0VIN000000002",
    status: "waiting-parts",
    total: "3,480.00 MDL",
  },
  {
    number: "ORD-DEMO-003",
    date: "2026-03-15",
    customer: "Unknown Customer",
    description: "Diagnostics",
    vehicle: "Toyota Corolla",
    vin: "DEMO0VIN000000003",
    status: "new",
    total: "450.00 MDL",
  },
  {
    number: "ORD-DEMO-004",
    date: "2026-03-16",
    customer: "Elena Rusu",
    description: "Tire rotation",
    vehicle: "Skoda Octavia",
    vin: "DEMO0VIN000000004",
    status: "completed",
    total: "680.00 MDL",
  },
];

/** Multilingual-looking source headers for the mapping step. */
export const MOCK_CUSTOMER_SOURCE_COLUMNS = [
  "Name / Nume / Имя",
  "Phone / Telefon / Телефон",
  "Email / E-mail",
  "Address / Adresă / Адрес",
  "Notes / Note / Заметки",
] as const;

export const MOCK_ORDER_SOURCE_COLUMNS = [
  "Order # / Nr. comandă / № заказа",
  "Date / Data / Дата",
  "Customer / Client / Клиент",
  "Description / Descriere / Описание",
  "Vehicle / Vehicul / Авто",
  "VIN",
  "Status / Статус",
  "Total / Сумма",
  "Extra / Extra",
] as const;

export const DEFAULT_CUSTOMER_MAPPINGS: Record<(typeof MOCK_CUSTOMER_SOURCE_COLUMNS)[number], CustomerDestinationField> = {
  "Name / Nume / Имя": "name",
  "Phone / Telefon / Телефон": "phone",
  "Email / E-mail": "email",
  "Address / Adresă / Адрес": "address",
  "Notes / Note / Заметки": "skip",
};

export const DEFAULT_ORDER_MAPPINGS: Record<(typeof MOCK_ORDER_SOURCE_COLUMNS)[number], OrderDestinationField> = {
  "Order # / Nr. comandă / № заказа": "number",
  "Date / Data / Дата": "date",
  "Customer / Client / Клиент": "customer",
  "Description / Descriere / Описание": "description",
  "Vehicle / Vehicul / Авто": "vehicle",
  VIN: "vin",
  "Status / Статус": "status",
  "Total / Сумма": "total",
  "Extra / Extra": "skip",
};

export const CUSTOMER_DESTINATION_FIELDS: CustomerDestinationField[] = [
  "skip",
  "name",
  "phone",
  "email",
  "address",
];

export const ORDER_DESTINATION_FIELDS: OrderDestinationField[] = [
  "skip",
  "number",
  "date",
  "customer",
  "description",
  "vehicle",
  "vin",
  "status",
  "total",
];

export const MOCK_VALIDATION_ISSUES: ImportDemoIssue[] = [
  { severity: "info", code: "ok", row: 1, messageKey: "settings.import.validation.okRow" },
  { severity: "info", code: "ok", row: 2, messageKey: "settings.import.validation.okRow" },
  {
    severity: "warning",
    code: "duplicate",
    row: 3,
    messageKey: "settings.import.validation.duplicatePhone",
    detail: "+373 69 100 201",
  },
  {
    severity: "error",
    code: "missing",
    row: 4,
    messageKey: "settings.import.validation.missingName",
  },
  {
    severity: "error",
    code: "unmatched",
    row: 5,
    messageKey: "settings.import.validation.unmatchedCustomer",
    detail: "Unknown Customer",
  },
];

export const DEMO_IMPORT_SUMMARY = {
  customersReady: 4,
  customersSkipped: 1,
  ordersReady: 3,
  ordersSkipped: 1,
  duplicates: 1,
  missingFields: 1,
  unmatchedCustomers: 1,
} as const;

export function formatDemoFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function importDemoStepIndex(step: ImportDemoStep) {
  return IMPORT_DEMO_STEPS.indexOf(step);
}

export function importDemoProgressPercent(step: ImportDemoStep) {
  const index = importDemoStepIndex(step);
  if (index < 0) return 0;
  return Math.round(((index + 1) / IMPORT_DEMO_STEPS.length) * 100);
}
