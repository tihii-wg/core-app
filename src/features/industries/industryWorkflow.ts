import i18n from "../../i18n";
import type { OrderStatus, serviceCategory } from "../../lib/types";
import { isValidOptionalVin, normalizeVin } from "../../lib/vin";

/** Stored order.status values (application constants; DB column is unconstrained text). */
export const ORDER_STATUSES: OrderStatus[] = ["new", "in-progress", "waiting-parts", "completed", "paid", "cancelled"];

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
export type IndustryCopyPack = "auto_repair" | "repair_device" | "field_service" | "default";

export type IndustryTerminology = {
  client: string;
  employee: string;
  service: string;
  inventory: string;
};

export type IndustryWorkflow = {
  slug: string;
  copyPack: IndustryCopyPack;
  orderFields: IndustryOrderFields;
  terminology: IndustryTerminology;
  /** Subset of existing serviceCategory values preferred for this industry. */
  serviceCategories: ServiceCategoryValue[];
};

const allServiceCategories: ServiceCategoryValue[] = [...SERVICE_CATEGORIES];
const autoServiceCategories: ServiceCategoryValue[] = ["repair", "assesment", "update"];
const deviceServiceCategories: ServiceCategoryValue[] = ["repair", "software", "data", "update", "assesment"];
const fieldServiceCategories: ServiceCategoryValue[] = ["repair", "assesment", "update"];

/** Automotive fields remain visible for auto_repair but are optional so empty drafts can be saved. */
const automotiveFields: IndustryOrderFields = {
  device: { visible: true, required: false },
  carNumber: { visible: true, required: false },
  vin: { visible: true, required: false, exactLength: 17 },
};

const repairDeviceFields: IndustryOrderFields = {
  device: { visible: true, required: false },
  carNumber: { visible: false, required: false },
  vin: { visible: false, required: false },
};

const fieldServiceFields: IndustryOrderFields = {
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

const defaultTerminology: IndustryTerminology = {
  client: "client",
  employee: "employee",
  service: "service",
  inventory: "inventory",
};

const workflowsBySlug: Record<KnownIndustrySlug, Omit<IndustryWorkflow, "slug">> = {
  auto_repair: { copyPack: "auto_repair", orderFields: automotiveFields, terminology: repairTerminology, serviceCategories: autoServiceCategories },
  phone_electronics_repair: { copyPack: "repair_device", orderFields: repairDeviceFields, terminology: repairTerminology, serviceCategories: deviceServiceCategories },
  computer_repair: { copyPack: "repair_device", orderFields: repairDeviceFields, terminology: repairTerminology, serviceCategories: deviceServiceCategories },
  appliance_repair: { copyPack: "repair_device", orderFields: repairDeviceFields, terminology: repairTerminology, serviceCategories: deviceServiceCategories },
  equipment_repair: { copyPack: "repair_device", orderFields: repairDeviceFields, terminology: repairTerminology, serviceCategories: deviceServiceCategories },
  electrical_services: { copyPack: "field_service", orderFields: fieldServiceFields, terminology: fieldTerminology, serviceCategories: fieldServiceCategories },
  home_services: { copyPack: "field_service", orderFields: fieldServiceFields, terminology: fieldTerminology, serviceCategories: fieldServiceCategories },
  other: { copyPack: "default", orderFields: defaultFields, terminology: defaultTerminology, serviceCategories: allServiceCategories },
};

function isKnownSlug(slug: string | null | undefined): slug is KnownIndustrySlug {
  return (KNOWN_INDUSTRY_SLUGS as readonly string[]).includes(slug ?? "");
}

/** Resolve workflow for a workspace industry slug; unknown/null → safe defaults (no automotive fields). */
export function industryWorkflow(slug: string | null | undefined): IndustryWorkflow {
  if (isKnownSlug(slug)) {
    return { slug, ...workflowsBySlug[slug] };
  }
  return {
    slug: slug?.trim() || "default",
    copyPack: "default",
    orderFields: defaultFields,
    terminology: defaultTerminology,
    serviceCategories: allServiceCategories,
  };
}

function isServiceCategory(value: string | null | undefined): value is ServiceCategoryValue {
  return (SERVICE_CATEGORIES as readonly string[]).includes(value ?? "");
}

/**
 * Category options for service forms. Always keeps a service's current category selectable
 * after an industry change so existing records stay editable.
 */
export function industryServiceCategoryOptions(workflow: IndustryWorkflow, currentCategory?: string | null): ServiceCategoryValue[] {
  const options = [...workflow.serviceCategories];
  if (currentCategory && isServiceCategory(currentCategory) && !options.includes(currentCategory)) {
    options.push(currentCategory);
  }
  return options;
}

export function serviceCategoryLabel(category: string | null | undefined) {
  if (!category?.trim()) return "";
  if (!isServiceCategory(category)) return category;
  return i18n.t(`services.categories.${category}`, { defaultValue: category });
}

/** Service UI copy that follows the active industry pack. */
export function industryServiceCopy(workflow: IndustryWorkflow) {
  const text = (key: string, legacyFallback: string) => {
    const packKey = `services.byIndustry.${workflow.copyPack}.${key}`;
    return i18n.t(packKey as "services.form.descriptionPlaceholder", {
      defaultValue: i18n.t(legacyFallback as "services.form.descriptionPlaceholder"),
    });
  };

  return {
    descriptionPlaceholder: text("descriptionPlaceholder", "services.form.descriptionPlaceholder"),
    namePlaceholder: text("namePlaceholder", "services.combobox.placeholder"),
    createDescription: text("createDescription", "services.dialogs.createDescription"),
    editDescription: text("editDescription", "services.dialogs.editDescription"),
  };
}

export function defaultServiceCategory(workflow: IndustryWorkflow): serviceCategory {
  return workflow.serviceCategories[0] ?? "repair";
}

/**
 * Client UI copy for the active industry pack.
 * Schema fields stay the same; only labels/placeholders/terminology adapt.
 */
export function industryClientCopy(workflow: IndustryWorkflow) {
  const text = (key: string, legacyFallback: string) => {
    const packKey = `clients.byIndustry.${workflow.copyPack}.${key}`;
    return i18n.t(packKey as "clients.form.addressLabel", {
      defaultValue: i18n.t(legacyFallback as "clients.form.addressLabel"),
    });
  };

  return {
    title: text("title", "clients.title"),
    loading: text("loading", "clients.loading"),
    addClient: text("addClient", "clients.addClient"),
    searchPlaceholder: text("searchPlaceholder", "clients.searchPlaceholder"),
    typeFilterLabel: text("typeFilterLabel", "clients.filters.clientType"),
    addDialogTitle: text("addDialogTitle", "clients.addDialog.title"),
    addDialogDescription: text("addDialogDescription", "clients.addDialog.description"),
    editDialogTitle: text("editDialogTitle", "clients.editDialog.title"),
    editDialogDescription: text("editDialogDescription", "clients.editDialog.description"),
    typeLabel: text("typeLabel", "clients.form.typeLabel"),
    addressLabel: text("addressLabel", "clients.form.addressLabel"),
    addressPlaceholder: text("addressPlaceholder", "clients.form.addressPlaceholder"),
    notesPlaceholder: text("notesPlaceholder", "clients.form.notesPlaceholder"),
    comboboxPlaceholder: text("comboboxPlaceholder", "clients.combobox.placeholder"),
    detailEditTitle: text("detailEditTitle", "clients.detail.editTitle"),
    detailSrDescription: text("detailSrDescription", "clients.detail.srDescription"),
    clientSince: (date: string) => {
      const packKey = `clients.byIndustry.${workflow.copyPack}.clientSince`;
      return i18n.t(packKey as "clients.detail.clientSince", {
        date,
        defaultValue: i18n.t("clients.detail.clientSince", { date }),
      });
    },
  };
}

/** Pluralized total-count line for the Clients page header. */
export function industryClientTotalCount(workflow: IndustryWorkflow, count: number) {
  const packKey = `clients.byIndustry.${workflow.copyPack}.totalCount`;
  return i18n.t(packKey as "clients.totalCount", {
    count,
    defaultValue: i18n.t("clients.totalCount", { count }),
  });
}

/**
 * Inventory UI copy for the active industry pack.
 * Category remains free-text in the DB; only labels/placeholders adapt (parts / supplies / inventory).
 */
export function industryInventoryCopy(workflow: IndustryWorkflow) {
  const text = (key: string, legacyFallback: string) => {
    const packKey = `inventory.byIndustry.${workflow.copyPack}.${key}`;
    return i18n.t(packKey as "inventory.title", {
      defaultValue: i18n.t(legacyFallback as "inventory.title"),
    });
  };

  return {
    title: text("title", "inventory.title"),
    loading: text("loading", "inventory.loading"),
    addItem: text("addItem", "inventory.addItem"),
    searchPlaceholder: text("searchPlaceholder", "inventory.searchPlaceholder"),
    addDialogTitle: text("addDialogTitle", "inventory.dialogs.addTitle"),
    addDialogDescription: text("addDialogDescription", "inventory.dialogs.addDescription"),
    editDialogTitle: text("editDialogTitle", "inventory.dialogs.editTitle"),
    editDialogDescription: text("editDialogDescription", "inventory.dialogs.editDescription"),
    deleteDialogTitle: text("deleteDialogTitle", "inventory.dialogs.deleteTitle"),
    detailFallbackTitle: text("detailFallbackTitle", "inventory.detail.fallbackTitle"),
    detailDescription: text("detailDescription", "inventory.detail.description"),
    namePlaceholder: text("namePlaceholder", "inventory.form.namePlaceholder"),
    categoryPlaceholder: text("categoryPlaceholder", "inventory.form.categoryPlaceholder"),
    locationPlaceholder: text("locationPlaceholder", "inventory.form.locationPlaceholder"),
  };
}

/** Pluralized item-count line for the Inventory page header. */
export function industryInventoryItemCount(workflow: IndustryWorkflow, count: number) {
  const packKey = `inventory.byIndustry.${workflow.copyPack}.itemCount`;
  return i18n.t(packKey as "inventory.itemCount", {
    count,
    defaultValue: i18n.t("inventory.itemCount", { count }),
  });
}

/**
 * Display label for a stored order status value.
 * Preserves underlying status keys (new, waiting-parts, …); only the translated label adapts.
 * True industry-specific transitions are not enforced here — statuses remain free to set in the UI.
 */
export function industryOrderStatusLabel(workflow: IndustryWorkflow, status: OrderStatus | string) {
  const packKey = `status.order.byIndustry.${workflow.copyPack}.${status}`;
  return i18n.t(packKey as "status.order.new", {
    defaultValue: i18n.t(`status.order.${status}` as "status.order.new", { defaultValue: status }),
  });
}

/**
 * Module / shell labels shared by sidebar, topbar, search, and dashboard.
 * Reuses clients/inventory/order pack copy — does not invent a second terminology map.
 */
export function industryModuleLabel(workflow: IndustryWorkflow, module: string): string {
  if (module === "clients") return industryClientCopy(workflow).title;
  if (module === "inventory") return industryInventoryCopy(workflow).title;
  return i18n.t(`nav.modules.${module}` as "nav.modules.dashboard", {
    defaultValue: module,
  });
}

export function industryShellCopy(workflow: IndustryWorkflow) {
  const clients = industryClientCopy(workflow);
  const inventory = industryInventoryCopy(workflow);
  const orders = industryOrderCopy(workflow);

  const clientPack = (key: string, legacy: string) =>
    i18n.t(`clients.byIndustry.${workflow.copyPack}.${key}` as "clients.title", {
      defaultValue: i18n.t(legacy as "clients.title"),
    });
  const inventoryPack = (key: string, legacy: string) =>
    i18n.t(`inventory.byIndustry.${workflow.copyPack}.${key}` as "inventory.title", {
      defaultValue: i18n.t(legacy as "inventory.title"),
    });

  return {
    clientsTitle: clients.title,
    clientsSingular: clients.comboboxPlaceholder,
    addClient: clients.addClient,
    inventoryTitle: inventory.title,
    addInventory: inventory.addItem,
    deviceColumn: orders.deviceLabel,
    newClients: clientPack("newClients", "dashboard.week.newClients"),
    clientCreated: clientPack("clientCreated", "dashboard.activity.clientCreated"),
    noClientsTitle: clientPack("emptyTitle", "common.empty.noClientsTitle"),
    noClientsDescription: clientPack("emptyDescription", "common.empty.noClientsDescription"),
    noClientsAction: clients.addClient,
    noInventoryTitle: inventoryPack("emptyTitle", "common.empty.noInventoryTitle"),
    noInventoryDescription: inventoryPack("emptyDescription", "common.empty.noInventoryDescription"),
    noInventoryAction: inventory.addItem,
    searchInputLabel: i18n.t(`search.byIndustry.${workflow.copyPack}.inputLabel` as "search.inputLabel", {
      defaultValue: i18n.t("search.inputLabel"),
    }),
    searchClientsError: clientPack("searchError", "search.errors.clients"),
    searchInventoryError: inventoryPack("searchError", "search.errors.inventory"),
    dashboardInventoryError: inventoryPack("loadError", "dashboard.errors.inventory"),
  };
}

function copyPath(pack: IndustryCopyPack, key: string) {
  return `orders.byIndustry.${pack}.${key}`;
}

function defaultCopyPath(key: string) {
  return `orders.byIndustry.default.${key}`;
}

/** Translated order-form / detail copy for the active industry pack. */
export function industryOrderCopy(workflow: IndustryWorkflow) {
  const text = (key: string, legacyFallback: string) => {
    const packKey = copyPath(workflow.copyPack, key);
    const fallbackKey = defaultCopyPath(key);
    // Dynamic pack keys are valid at runtime; cast avoids brittle i18next key unions.
    return i18n.t(packKey as "orders.byIndustry.default.deviceLabel", {
      defaultValue: i18n.t(fallbackKey as "orders.byIndustry.default.deviceLabel", {
        defaultValue: i18n.t(legacyFallback as "orders.form.deviceLabel"),
      }),
    });
  };

  return {
    deviceLabel: text("deviceLabel", "orders.form.deviceLabel"),
    devicePlaceholder: text("devicePlaceholder", "orders.form.devicePlaceholder"),
    deviceRequired: text("deviceRequired", "orders.validation.deviceRequired"),
    deviceDetail: text("deviceDetail", "orders.detail.device"),
    carNumberLabel: text("carNumberLabel", "orders.form.carNumberLabel"),
    carNumberPlaceholder: text("carNumberPlaceholder", "orders.form.carNumberPlaceholder"),
    carNumberRequired: text("carNumberRequired", "orders.validation.carNumberRequired"),
    carNumberDetail: text("carNumberDetail", "orders.detail.carNumber"),
    vinLabel: text("vinLabel", "orders.form.vinLabel"),
    vinPlaceholder: text("vinPlaceholder", "orders.form.vinPlaceholder"),
    vinRequired: text("vinRequired", "orders.validation.vinRequired"),
    vinLength: text("vinLength", "orders.validation.vinLength"),
    vinDetail: text("vinDetail", "orders.detail.vin"),
    deviceServiceColumn: text("deviceServiceColumn", "orders.table.deviceService"),
    deadlineLabel: text("deadlineLabel", "orders.form.deadlineLabel"),
    deadlineDetail: text("deadlineDetail", "orders.detail.deadline"),
    descriptionPlaceholder: text("descriptionPlaceholder", "orders.form.descriptionPlaceholder"),
    editDescription: text("editDescription", "orders.editDialog.description"),
    detailSrDescription: text("detailSrDescription", "orders.detail.srDescription"),
    assignedEmployeeLabel: text("assignedEmployeeLabel", "orders.form.assignedEmployeeLabel"),
    assignedEmployeeRequiredLabel: text("assignedEmployeeRequiredLabel", "orders.form.assignedEmployeeRequiredLabel"),
  };
}

export function orderAssetFieldRules(field: OrderAssetFieldConfig, messages: { required: string; length?: string }) {
  if (!field.visible) return {};

  return {
    ...(field.required ? { required: messages.required } : {}),
    ...(field.exactLength
      ? {
          validate: (value: string) => {
            const trimmed = normalizeVin(value);
            if (!trimmed) return field.required ? messages.required : true;
            // Automotive VIN (exactLength 17): enforce ISO 3779 charset (no I/O/Q).
            if (field.exactLength === 17) {
              return isValidOptionalVin(trimmed) || messages.length || true;
            }
            return trimmed.length === field.exactLength || messages.length || true;
          },
        }
      : {}),
  };
}

/**
 * Detail / invoice screens:
 * - Always show a stored value (historical data survives industry changes).
 * - Never render empty plate/VIN shells (avoids blank automotive labels).
 * - Show empty device only when the industry configures it as a visible primary field.
 */
export function shouldShowOrderAssetValue(
  field: OrderAssetFieldConfig,
  value: string | null | undefined,
  fieldName: OrderAssetFieldName = "device",
) {
  if (value?.trim()) return true;
  if (!field.visible) return false;
  return fieldName === "device";
}

/** Field names that are currently hidden — clear their validation when the industry changes. */
export function hiddenOrderAssetFields(workflow: IndustryWorkflow): OrderAssetFieldName[] {
  return (Object.keys(workflow.orderFields) as OrderAssetFieldName[]).filter((name) => !workflow.orderFields[name].visible);
}
