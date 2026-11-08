/**
 * Single source of truth for workspace industry behaviour (Phase 1 — frontend).
 * Unknown / missing slugs resolve to the "other" profile.
 */

import type { StatusGroup, StatusSemanticAction } from "../../services/apiStatusDefinitions";
import i18n from "../../i18n";
import type { DocumentTemplateType } from "../documents/layout";
import type { PaymentStageTemplateItem } from "../finance/paymentStages";

/** Stored services.category values used by the app (includes historical spelling "assesment"). */
export const SERVICE_CATEGORIES = ["repair", "software", "update", "data", "assesment"] as const;
export type ServiceCategoryValue = (typeof SERVICE_CATEGORIES)[number];

/** Database industry slugs from public.industries (resolve by slug, never by UUID). */
export const KNOWN_INDUSTRY_SLUGS = [
  "auto_repair",
  "phone_electronics_repair",
  "computer_repair",
  "appliance_repair",
  "equipment_repair",
  "electrical_services",
  "home_services",
  "furniture_manufacturing",
  "other",
] as const;

export type KnownIndustrySlug = (typeof KNOWN_INDUSTRY_SLUGS)[number];

export type OrderAssetFieldName = "device" | "carNumber" | "vin";

export type OrderAssetFieldConfig = {
  visible: boolean;
  required: boolean;
  /** When set, non-empty values must match this length (VIN). */
  exactLength?: number;
};

export type IndustryOrderFields = Record<OrderAssetFieldName, OrderAssetFieldConfig>;

/** Shared copy packs under orders.byIndustry.<pack>. */
export type IndustryCopyPack =
  | "auto_repair"
  | "repair_device"
  | "field_service"
  | "furniture_manufacturing"
  | "default";

export type IndustryTerminology = {
  client: string;
  employee: string;
  service: string;
  inventory: string;
};

export type IndustryAssetKind = "vehicle" | "device" | "site" | "project" | "none";

/** i18n key paths under `industries.terms.*` (or pack-specific overrides). */
export type IndustryTermKey =
  | "orderSingular"
  | "orderPlural"
  | "workOrderDocument"
  | "technician"
  | "parts"
  | "services"
  | "asset"
  | "navInventoryShort"
  | "materialsWarehouse";

export type IndustryOrderFieldBlocks = {
  /** Client vehicle picker / automotive grid (auto only). */
  vehicleGrid: boolean;
  /** Device / make-model style field (device industries). */
  deviceFields: boolean;
  /** Address / site / object field (reuses order.device column). */
  addressField: boolean;
  /** Treat description/notes as product type + dimensions (furniture). */
  descriptionAsProductNotes: boolean;
  /** Dedicated `orders.device_serial` (device industries). */
  deviceSerial: boolean;
  /** Dedicated `orders.device_imei` — phones only. */
  deviceImei: boolean;
  /** Intake condition (`orders.device_condition`). */
  deviceCondition: boolean;
  /** Intake completeness (`orders.device_completeness`). */
  deviceCompleteness: boolean;
  /** Unlock code / pattern (`orders.device_passcode`) — never printed. */
  devicePasscode: boolean;
  /** Object / site address (`orders.site_address`). */
  siteAddress: boolean;
  /** Product dimensions (`orders.product_dimensions`). */
  productDimensions: boolean;
  /** Measurement appointment (`orders.measurement_at`). */
  measurementAt: boolean;
  /** Installation appointment (`orders.installation_at`). */
  installationAt: boolean;
};

export type IndustryWarrantyProfile = {
  unit: "months" | "days";
  defaultValue: number;
  /** Odometer-based warranty — only auto_repair. */
  mileage: boolean;
};

export type IndustryDocumentRole =
  | "work_order"
  | "act"
  | "invoice"
  | "contract"
  | "specification"
  | "prepayment_invoice"
  | "balance_invoice"
  | "receipt"
  | "warranty_card"
  | "job_ticket";

export type IndustryDocumentSpec = {
  role: IndustryDocumentRole;
  /** Existing storage/layout type. */
  documentType: DocumentTemplateType;
  /** i18n key for the default template name. */
  nameKey: string;
};

export type IndustryStatusSeed = {
  /** i18n key under industries.statuses.<slug>.* or shared. */
  nameKey: string;
  statusGroup: StatusGroup;
  systemStatus: string | null;
  semanticAction: StatusSemanticAction;
  isDefault?: boolean;
  color: string;
  /** Minimum paid percent (0–100) of the order total required to enter this status. */
  minPaidPercent?: number;
};

/** Default payment stage seed; `nameKey` is resolved via i18n into PaymentStageTemplateItem.name. */
export type PaymentStageTemplateSeed = {
  nameKey: string;
  mode: "percent" | "amount" | "remainder";
  percent?: number;
  amount?: number;
  dueDays?: number;
};

export type IndustryNavigationProfile = {
  /** Inventory sidebar / page label → materials warehouse wording. */
  materialsWarehouseLabel: boolean;
  /** Show client vehicles section (auto only). */
  clientVehicles: boolean;
};

export type IndustryProfile = {
  slug: KnownIndustrySlug;
  assetKind: IndustryAssetKind;
  copyPack: IndustryCopyPack;
  /** Legacy short terminology tokens (client/employee/service/inventory). */
  terminology: IndustryTerminology;
  /** Pack namespace for industries.terms.<pack>.* */
  termsPack: string;
  orderFields: IndustryOrderFields;
  orderFieldBlocks: IndustryOrderFieldBlocks;
  serviceCategories: ServiceCategoryValue[];
  /** Suggested free-text catalog category i18n keys (services/inventory hints). */
  suggestedCatalogCategoryKeys: readonly string[];
  defaultStatuses: readonly IndustryStatusSeed[];
  warranty: IndustryWarrantyProfile;
  documents: readonly IndustryDocumentSpec[];
  /** Default payment stages applied to new orders (unless the workspace overrides them). */
  paymentStageTemplate: readonly PaymentStageTemplateSeed[];
  navigation: IndustryNavigationProfile;
  /** Demo print pack under settings.printTemplates.demo.byIndustry.<pack> */
  demoPack: string;
};

const allServiceCategories: ServiceCategoryValue[] = [...SERVICE_CATEGORIES];
const autoServiceCategories: ServiceCategoryValue[] = ["repair", "assesment", "update"];
const deviceServiceCategories: ServiceCategoryValue[] = ["repair", "software", "data", "update", "assesment"];
const fieldServiceCategories: ServiceCategoryValue[] = ["repair", "assesment", "update"];
const furnitureServiceCategories: ServiceCategoryValue[] = ["repair", "assesment", "update"];

const automotiveFields: IndustryOrderFields = {
  device: { visible: true, required: false },
  carNumber: { visible: true, required: false },
  vin: { visible: true, required: false, exactLength: 17 },
};

/** Device industries: model name; serial/IMEI live in dedicated columns via orderFieldBlocks. */
const repairDeviceFields: IndustryOrderFields = {
  device: { visible: true, required: false },
  carNumber: { visible: false, required: false },
  vin: { visible: false, required: false },
};

const siteProjectFields: IndustryOrderFields = {
  device: { visible: true, required: false },
  carNumber: { visible: false, required: false },
  vin: { visible: false, required: false },
};

const defaultFields: IndustryOrderFields = {
  device: { visible: true, required: false },
  carNumber: { visible: false, required: false },
  vin: { visible: false, required: false },
};

const repairTerminology: IndustryTerminology = {
  client: "client",
  employee: "technician",
  service: "service",
  inventory: "parts",
};

const fieldTerminology: IndustryTerminology = {
  client: "customer",
  employee: "technician",
  service: "service",
  inventory: "supplies",
};

const furnitureTerminology: IndustryTerminology = {
  client: "client",
  employee: "technician",
  service: "service",
  inventory: "parts",
};

const defaultTerminology: IndustryTerminology = {
  client: "client",
  employee: "employee",
  service: "service",
  inventory: "inventory",
};

const noIndustryExtras = {
  deviceSerial: false,
  deviceImei: false,
  deviceCondition: false,
  deviceCompleteness: false,
  devicePasscode: false,
  siteAddress: false,
  productDimensions: false,
  measurementAt: false,
  installationAt: false,
} as const;

const vehicleBlocks: IndustryOrderFieldBlocks = {
  vehicleGrid: true,
  deviceFields: false,
  addressField: false,
  descriptionAsProductNotes: false,
  ...noIndustryExtras,
};

const deviceBlocksBase = {
  vehicleGrid: false,
  deviceFields: true,
  addressField: false,
  descriptionAsProductNotes: false,
  deviceSerial: true,
  deviceCondition: true,
  deviceCompleteness: true,
  devicePasscode: true,
  siteAddress: false,
  productDimensions: false,
  measurementAt: false,
  installationAt: false,
} as const;

/** Non-phone device industries: serial + intake fields, no IMEI. */
const deviceBlocks: IndustryOrderFieldBlocks = {
  ...deviceBlocksBase,
  deviceImei: false,
};

/** Phone / electronics: same as device plus IMEI. */
const phoneDeviceBlocks: IndustryOrderFieldBlocks = {
  ...deviceBlocksBase,
  deviceImei: true,
};

const siteBlocks: IndustryOrderFieldBlocks = {
  vehicleGrid: false,
  deviceFields: false,
  addressField: true,
  descriptionAsProductNotes: false,
  ...noIndustryExtras,
  siteAddress: true,
};

const projectBlocks: IndustryOrderFieldBlocks = {
  vehicleGrid: false,
  deviceFields: false,
  addressField: true,
  descriptionAsProductNotes: true,
  ...noIndustryExtras,
  siteAddress: true,
  productDimensions: true,
  measurementAt: true,
  installationAt: true,
};

const noneBlocks: IndustryOrderFieldBlocks = {
  vehicleGrid: false,
  deviceFields: false,
  addressField: false,
  descriptionAsProductNotes: false,
  ...noIndustryExtras,
};

function status(
  nameKey: string,
  statusGroup: StatusGroup,
  opts: {
    systemStatus?: string | null;
    semanticAction?: StatusSemanticAction;
    isDefault?: boolean;
    color?: string;
    minPaidPercent?: number;
  } = {},
): IndustryStatusSeed {
  return {
    nameKey,
    statusGroup,
    systemStatus: opts.systemStatus ?? null,
    semanticAction: opts.semanticAction ?? "normal",
    isDefault: opts.isDefault,
    color: opts.color ?? "#2563eb",
    ...(opts.minPaidPercent != null ? { minPaidPercent: opts.minPaidPercent } : {}),
  };
}

const autoStatuses: IndustryStatusSeed[] = [
  status("industries.statuses.auto.new", "new", { systemStatus: "new", isDefault: true, color: "#2563eb" }),
  status("industries.statuses.auto.inProgress", "in_progress", { systemStatus: "in-progress", color: "#7c3aed" }),
  status("industries.statuses.auto.waitingParts", "pending", { systemStatus: "waiting-parts", color: "#d97706" }),
  status("industries.statuses.auto.completed", "done", { systemStatus: "completed", color: "#059669" }),
  status("industries.statuses.auto.closed", "closed", { semanticAction: "close", color: "#334155" }),
  status("industries.statuses.auto.cancelled", "canceled", { semanticAction: "cancel", color: "#dc2626" }),
];

const deviceStatuses: IndustryStatusSeed[] = [
  status("industries.statuses.device.accepted", "new", { systemStatus: "new", isDefault: true, color: "#2563eb" }),
  status("industries.statuses.device.diagnostics", "in_progress", { color: "#7c3aed" }),
  status("industries.statuses.device.approval", "pending", { color: "#ca8a04" }),
  status("industries.statuses.device.waitingPart", "pending", { systemStatus: "waiting-parts", color: "#d97706" }),
  status("industries.statuses.device.inRepair", "in_progress", { systemStatus: "in-progress", color: "#4f46e5" }),
  status("industries.statuses.device.ready", "done", { systemStatus: "completed", color: "#059669" }),
  status("industries.statuses.device.issued", "closed", { semanticAction: "close", color: "#334155" }),
  status("industries.statuses.device.refused", "canceled", { semanticAction: "cancel", color: "#dc2626" }),
];

const siteStatuses: IndustryStatusSeed[] = [
  status("industries.statuses.site.newRequest", "new", { systemStatus: "new", isDefault: true, color: "#2563eb" }),
  status("industries.statuses.site.visitScheduled", "pending", { color: "#ca8a04" }),
  status("industries.statuses.site.inProgress", "in_progress", { systemStatus: "in-progress", color: "#7c3aed" }),
  status("industries.statuses.site.done", "done", { systemStatus: "completed", color: "#059669" }),
  status("industries.statuses.site.closed", "closed", { semanticAction: "close", color: "#334155" }),
  status("industries.statuses.site.cancelled", "canceled", { semanticAction: "cancel", color: "#dc2626" }),
];

const furnitureStatuses: IndustryStatusSeed[] = [
  status("industries.statuses.furniture.newRequest", "new", { systemStatus: "new", isDefault: true, color: "#2563eb" }),
  status("industries.statuses.furniture.measurement", "pending", { color: "#0891b2" }),
  status("industries.statuses.furniture.designQuote", "pending", { color: "#ca8a04" }),
  status("industries.statuses.furniture.approved", "in_progress", { color: "#4f46e5" }),
  status("industries.statuses.furniture.prepayment", "paid", { color: "#059669" }),
  status("industries.statuses.furniture.inProduction", "in_progress", {
    systemStatus: "in-progress",
    color: "#7c3aed",
    minPaidPercent: 50,
  }),
  status("industries.statuses.furniture.readyForDelivery", "delivery", { color: "#0d9488" }),
  status("industries.statuses.furniture.deliveryInstall", "delivery", { color: "#0284c7" }),
  status("industries.statuses.furniture.handedOver", "closed", { semanticAction: "close", color: "#334155" }),
  status("industries.statuses.furniture.cancelled", "canceled", { semanticAction: "cancel", color: "#dc2626" }),
];

const otherStatuses: IndustryStatusSeed[] = [
  status("industries.statuses.other.new", "new", { systemStatus: "new", isDefault: true, color: "#2563eb" }),
  status("industries.statuses.other.inProgress", "in_progress", { systemStatus: "in-progress", color: "#7c3aed" }),
  status("industries.statuses.other.done", "done", { systemStatus: "completed", color: "#059669" }),
  status("industries.statuses.other.closed", "closed", { semanticAction: "close", color: "#334155" }),
  status("industries.statuses.other.cancelled", "canceled", { semanticAction: "cancel", color: "#dc2626" }),
];

const autoDocuments: IndustryDocumentSpec[] = [
  { role: "work_order", documentType: "work_order", nameKey: "industries.documents.auto.workOrder" },
  { role: "act", documentType: "act", nameKey: "industries.documents.auto.act" },
  { role: "invoice", documentType: "invoice", nameKey: "industries.documents.auto.invoice" },
];

const deviceDocuments: IndustryDocumentSpec[] = [
  { role: "receipt", documentType: "work_order", nameKey: "industries.documents.device.receipt" },
  { role: "act", documentType: "act", nameKey: "industries.documents.device.act" },
  { role: "warranty_card", documentType: "act", nameKey: "industries.documents.device.warrantyCard" },
];

const siteDocuments: IndustryDocumentSpec[] = [
  { role: "job_ticket", documentType: "work_order", nameKey: "industries.documents.site.jobTicket" },
  { role: "act", documentType: "act", nameKey: "industries.documents.site.act" },
  { role: "invoice", documentType: "invoice", nameKey: "industries.documents.site.invoice" },
];

const furnitureDocuments: IndustryDocumentSpec[] = [
  { role: "contract", documentType: "work_order", nameKey: "industries.documents.furniture.contract" },
  { role: "specification", documentType: "work_order", nameKey: "industries.documents.furniture.specification" },
  { role: "prepayment_invoice", documentType: "invoice", nameKey: "industries.documents.furniture.prepaymentInvoice" },
  { role: "balance_invoice", documentType: "invoice", nameKey: "industries.documents.furniture.balanceInvoice" },
  { role: "act", documentType: "act", nameKey: "industries.documents.furniture.act" },
];

const otherDocuments: IndustryDocumentSpec[] = [
  { role: "work_order", documentType: "work_order", nameKey: "industries.documents.other.workOrder" },
  { role: "act", documentType: "act", nameKey: "industries.documents.other.act" },
  { role: "invoice", documentType: "invoice", nameKey: "industries.documents.other.invoice" },
];

const defaultPaymentStages: readonly PaymentStageTemplateSeed[] = [
  { nameKey: "industries.paymentStages.default.fullPayment", mode: "remainder" },
];

const fieldPaymentStages: readonly PaymentStageTemplateSeed[] = [
  { nameKey: "industries.paymentStages.field.advance", mode: "percent", percent: 50 },
  { nameKey: "industries.paymentStages.field.remainder", mode: "remainder" },
];

const furniturePaymentStages: readonly PaymentStageTemplateSeed[] = [
  { nameKey: "industries.paymentStages.furniture.prepayment", mode: "percent", percent: 50, dueDays: 0 },
  { nameKey: "industries.paymentStages.furniture.afterMeasurement", mode: "percent", percent: 30 },
  { nameKey: "industries.paymentStages.furniture.remainder", mode: "remainder" },
];

const furnitureCatalogKeys = [
  "industries.catalog.furniture.measurement",
  "industries.catalog.furniture.design",
  "industries.catalog.furniture.production",
  "industries.catalog.furniture.delivery",
  "industries.catalog.furniture.installation",
  "industries.catalog.furniture.hardware",
  "industries.catalog.furniture.materials",
] as const;

function deviceWarranty(defaultMonths: number): IndustryWarrantyProfile {
  return { unit: "months", defaultValue: defaultMonths, mileage: false };
}

const profilesBySlug: Record<KnownIndustrySlug, Omit<IndustryProfile, "slug">> = {
  auto_repair: {
    assetKind: "vehicle",
    copyPack: "auto_repair",
    terminology: repairTerminology,
    termsPack: "auto",
    orderFields: automotiveFields,
    orderFieldBlocks: vehicleBlocks,
    serviceCategories: autoServiceCategories,
    suggestedCatalogCategoryKeys: [],
    defaultStatuses: autoStatuses,
    warranty: { unit: "months", defaultValue: 6, mileage: true },
    documents: autoDocuments,
    paymentStageTemplate: defaultPaymentStages,
    navigation: { materialsWarehouseLabel: false, clientVehicles: true },
    demoPack: "vehicle",
  },
  phone_electronics_repair: {
    assetKind: "device",
    copyPack: "repair_device",
    terminology: repairTerminology,
    termsPack: "device",
    orderFields: repairDeviceFields,
    orderFieldBlocks: phoneDeviceBlocks,
    serviceCategories: deviceServiceCategories,
    suggestedCatalogCategoryKeys: [],
    defaultStatuses: deviceStatuses,
    warranty: deviceWarranty(3),
    documents: deviceDocuments,
    paymentStageTemplate: defaultPaymentStages,
    navigation: { materialsWarehouseLabel: false, clientVehicles: false },
    demoPack: "device",
  },
  computer_repair: {
    assetKind: "device",
    copyPack: "repair_device",
    terminology: repairTerminology,
    termsPack: "device",
    orderFields: repairDeviceFields,
    orderFieldBlocks: deviceBlocks,
    serviceCategories: deviceServiceCategories,
    suggestedCatalogCategoryKeys: [],
    defaultStatuses: deviceStatuses,
    warranty: deviceWarranty(3),
    documents: deviceDocuments,
    paymentStageTemplate: defaultPaymentStages,
    navigation: { materialsWarehouseLabel: false, clientVehicles: false },
    demoPack: "device",
  },
  appliance_repair: {
    assetKind: "device",
    copyPack: "repair_device",
    terminology: repairTerminology,
    termsPack: "device",
    orderFields: repairDeviceFields,
    orderFieldBlocks: deviceBlocks,
    serviceCategories: deviceServiceCategories,
    suggestedCatalogCategoryKeys: [],
    defaultStatuses: deviceStatuses,
    warranty: deviceWarranty(6),
    documents: deviceDocuments,
    paymentStageTemplate: defaultPaymentStages,
    navigation: { materialsWarehouseLabel: false, clientVehicles: false },
    demoPack: "device",
  },
  equipment_repair: {
    assetKind: "device",
    copyPack: "repair_device",
    terminology: repairTerminology,
    termsPack: "device",
    orderFields: repairDeviceFields,
    orderFieldBlocks: deviceBlocks,
    serviceCategories: deviceServiceCategories,
    suggestedCatalogCategoryKeys: [],
    defaultStatuses: deviceStatuses,
    warranty: deviceWarranty(6),
    documents: deviceDocuments,
    paymentStageTemplate: fieldPaymentStages,
    navigation: { materialsWarehouseLabel: false, clientVehicles: false },
    demoPack: "device",
  },
  electrical_services: {
    assetKind: "site",
    copyPack: "field_service",
    terminology: fieldTerminology,
    termsPack: "site",
    orderFields: siteProjectFields,
    orderFieldBlocks: siteBlocks,
    serviceCategories: fieldServiceCategories,
    suggestedCatalogCategoryKeys: [],
    defaultStatuses: siteStatuses,
    warranty: { unit: "months", defaultValue: 12, mileage: false },
    documents: siteDocuments,
    paymentStageTemplate: fieldPaymentStages,
    navigation: { materialsWarehouseLabel: false, clientVehicles: false },
    demoPack: "site",
  },
  home_services: {
    assetKind: "site",
    copyPack: "field_service",
    terminology: fieldTerminology,
    termsPack: "site",
    orderFields: siteProjectFields,
    orderFieldBlocks: siteBlocks,
    serviceCategories: fieldServiceCategories,
    suggestedCatalogCategoryKeys: [],
    defaultStatuses: siteStatuses,
    warranty: { unit: "months", defaultValue: 12, mileage: false },
    documents: siteDocuments,
    paymentStageTemplate: fieldPaymentStages,
    navigation: { materialsWarehouseLabel: false, clientVehicles: false },
    demoPack: "site",
  },
  furniture_manufacturing: {
    assetKind: "project",
    copyPack: "furniture_manufacturing",
    terminology: furnitureTerminology,
    termsPack: "furniture",
    orderFields: siteProjectFields,
    orderFieldBlocks: projectBlocks,
    serviceCategories: furnitureServiceCategories,
    suggestedCatalogCategoryKeys: furnitureCatalogKeys,
    defaultStatuses: furnitureStatuses,
    warranty: { unit: "months", defaultValue: 12, mileage: false },
    documents: furnitureDocuments,
    paymentStageTemplate: furniturePaymentStages,
    navigation: { materialsWarehouseLabel: true, clientVehicles: false },
    demoPack: "furniture",
  },
  other: {
    assetKind: "none",
    copyPack: "default",
    terminology: defaultTerminology,
    termsPack: "other",
    orderFields: defaultFields,
    orderFieldBlocks: noneBlocks,
    serviceCategories: allServiceCategories,
    suggestedCatalogCategoryKeys: [],
    defaultStatuses: otherStatuses,
    warranty: { unit: "months", defaultValue: 3, mileage: false },
    documents: otherDocuments,
    paymentStageTemplate: defaultPaymentStages,
    navigation: { materialsWarehouseLabel: false, clientVehicles: false },
    demoPack: "other",
  },
};

function isKnownSlug(slug: string | null | undefined): slug is KnownIndustrySlug {
  return (KNOWN_INDUSTRY_SLUGS as readonly string[]).includes(slug ?? "");
}

/** Resolve industry profile; unknown/null → `other`. */
export function industryProfile(slug: string | null | undefined): IndustryProfile {
  if (isKnownSlug(slug)) {
    return { slug, ...profilesBySlug[slug] };
  }
  return { slug: "other", ...profilesBySlug.other };
}

export function industryTermKeyPath(profile: IndustryProfile, term: IndustryTermKey): string {
  return `industries.terms.${profile.termsPack}.${term}`;
}

/** Open (non-cancelled) default statuses for a profile. */
export function industryOpenStatusSeeds(profile: IndustryProfile): IndustryStatusSeed[] {
  return profile.defaultStatuses.filter((seed) => seed.semanticAction !== "cancel");
}

type PaymentStageTranslate = (key: string, options?: { defaultValue?: string }) => string;

/**
 * Resolves the profile's payment stage seeds into template items with translated names.
 * `t` defaults to the app i18n instance.
 */
export function industryPaymentStageTemplate(
  profile: IndustryProfile,
  t: PaymentStageTranslate = (key, options) => String(i18n.t(key as never, options as never)),
): PaymentStageTemplateItem[] {
  return profile.paymentStageTemplate.map((seed) => ({
    name: String(t(seed.nameKey, { defaultValue: seed.nameKey })),
    mode: seed.mode,
    percent: seed.mode === "percent" ? (seed.percent ?? 0) : null,
    amount: seed.mode === "amount" ? (seed.amount ?? 0) : null,
    dueDays: seed.dueDays ?? null,
  }));
}

export function assertIndustryProfilesComplete(): void {
  for (const slug of KNOWN_INDUSTRY_SLUGS) {
    const profile = industryProfile(slug);
    if (profile.slug !== slug) throw new Error(`Profile slug mismatch for ${slug}`);
    if (!profile.defaultStatuses.length) throw new Error(`No statuses for ${slug}`);
    if (!profile.documents.length) throw new Error(`No documents for ${slug}`);
    if (!profile.paymentStageTemplate.length) throw new Error(`No payment stages for ${slug}`);
  }
}
