import i18n from "../../i18n";

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
};

const automotiveFields: IndustryOrderFields = {
  device: { visible: true, required: true },
  carNumber: { visible: true, required: true },
  vin: { visible: true, required: true, exactLength: 17 },
};

const repairDeviceFields: IndustryOrderFields = {
  device: { visible: true, required: true },
  carNumber: { visible: false, required: false },
  vin: { visible: false, required: false },
};

const fieldServiceFields: IndustryOrderFields = {
  device: { visible: true, required: true },
  carNumber: { visible: false, required: false },
  vin: { visible: false, required: false },
};

const defaultFields: IndustryOrderFields = {
  device: { visible: true, required: true },
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
  auto_repair: { copyPack: "auto_repair", orderFields: automotiveFields, terminology: repairTerminology },
  phone_electronics_repair: { copyPack: "repair_device", orderFields: repairDeviceFields, terminology: repairTerminology },
  computer_repair: { copyPack: "repair_device", orderFields: repairDeviceFields, terminology: repairTerminology },
  appliance_repair: { copyPack: "repair_device", orderFields: repairDeviceFields, terminology: repairTerminology },
  equipment_repair: { copyPack: "repair_device", orderFields: repairDeviceFields, terminology: repairTerminology },
  electrical_services: { copyPack: "field_service", orderFields: fieldServiceFields, terminology: fieldTerminology },
  home_services: { copyPack: "field_service", orderFields: fieldServiceFields, terminology: fieldTerminology },
  other: { copyPack: "default", orderFields: defaultFields, terminology: defaultTerminology },
};

function isKnownSlug(slug: string | null | undefined): slug is KnownIndustrySlug {
  return (KNOWN_INDUSTRY_SLUGS as readonly string[]).includes(slug ?? "");
}

/** Resolve workflow for a workspace industry slug; unknown/null → safe defaults (no automotive fields). */
export function industryWorkflow(slug: string | null | undefined): IndustryWorkflow {
  if (isKnownSlug(slug)) {
    return { slug, ...workflowsBySlug[slug] };
  }
  return { slug: slug?.trim() || "default", copyPack: "default", orderFields: defaultFields, terminology: defaultTerminology };
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
            const trimmed = value?.trim() ?? "";
            if (!trimmed) return field.required ? messages.required : true;
            return trimmed.length === field.exactLength || messages.length || true;
          },
        }
      : {}),
  };
}

/** Detail screens: show configured fields, and keep historical values visible when present. */
export function shouldShowOrderAssetValue(field: OrderAssetFieldConfig, value: string | null | undefined) {
  if (field.visible) return true;
  return Boolean(value?.trim());
}
