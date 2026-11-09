import type { IndustryOrderFieldBlocks, IndustryProfile } from "../industries/industryProfile";
import { industryOrderCopy, type IndustryWorkflow } from "../industries/industryWorkflow";
import i18n from "../../i18n";

/** Settings / preview grouping for built-in + custom fields. */
export type OrderFieldGroup = "clientOrder" | "asset" | "work" | "custom";

/** Built-in order field keys that can be overridden via custom_field_definitions (is_system). */
export const BUILTIN_ORDER_FIELD_KEYS = [
  "client",
  "vehicle",
  "vehicleMake",
  "vehicleModel",
  "vehicleYear",
  "vehicleLicensePlate",
  "vehicleVin",
  "vehicleInitialMileage",
  "vehicleCurrentMileage",
  "vehicleEngineDisplacement",
  "vehicleFuelType",
  "device",
  "carNumber",
  "vin",
  "deviceSerial",
  "deviceImei",
  "deviceCondition",
  "deviceCompleteness",
  "devicePasscode",
  "siteAddress",
  "productDimensions",
  "measurementAt",
  "installationAt",
  "description",
  "assignedEmployee",
  "team",
  "services",
  "materials",
  "deadline",
  "status",
  "total",
] as const;

export type BuiltinOrderFieldKey = (typeof BUILTIN_ORDER_FIELD_KEYS)[number];

export type OrderFieldType =
  | "header"
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "datetime"
  | "select"
  | "checkbox"
  | "directory"
  | "builtin";

export type BuiltinOrderFieldMeta = {
  key: BuiltinOrderFieldKey;
  group: OrderFieldGroup;
  /** Default field_type stored when creating a system override row. */
  type: OrderFieldType;
  canHide: boolean;
  canRequire: boolean;
  canRename: boolean;
  /** Whether this field applies for the given industry profile. */
  appliesTo: (profile: IndustryProfile) => boolean;
  /** Industry-aware default label. */
  defaultLabel: (workflow: IndustryWorkflow) => string;
  /** Default required from industry profile (when no override). */
  defaultRequired: (profile: IndustryProfile) => boolean;
  /** Default sort among built-ins (before custom fields). */
  defaultSortOrder: number;
};

function blockOn(blocks: IndustryOrderFieldBlocks, key: keyof IndustryOrderFieldBlocks) {
  return Boolean(blocks[key]);
}

function always() {
  return true;
}

function usesClientVehicles(profile: IndustryProfile) {
  return Boolean(profile.navigation.clientVehicles);
}

function assetVisible(profile: IndustryProfile, name: "device" | "carNumber" | "vin") {
  return !usesClientVehicles(profile) && profile.orderFields[name].visible;
}

function assetRequired(profile: IndustryProfile, name: "device" | "carNumber" | "vin") {
  return assetVisible(profile, name) && profile.orderFields[name].required;
}

function vehiclesOnly(profile: IndustryProfile) {
  return usesClientVehicles(profile);
}

/** Map VehicleFieldsGrid row keys → registry keys (order context). */
export const VEHICLE_GRID_FIELD_KEY: Record<string, BuiltinOrderFieldKey> = {
  make: "vehicleMake",
  model: "vehicleModel",
  year: "vehicleYear",
  vin: "vehicleVin",
  licensePlate: "vehicleLicensePlate",
  initialMileage: "vehicleInitialMileage",
  currentMileage: "vehicleCurrentMileage",
  engineDisplacement: "vehicleEngineDisplacement",
  fuelType: "vehicleFuelType",
};

/** Legacy system override keys → vehicle keys when industry supports client vehicles. */
export const LEGACY_ASSET_TO_VEHICLE_FIELD: Partial<Record<string, BuiltinOrderFieldKey>> = {
  carNumber: "vehicleLicensePlate",
  vin: "vehicleVin",
  device: "vehicleMake",
};

/** Single registry of built-in order fields. */
export const BUILTIN_ORDER_FIELDS: readonly BuiltinOrderFieldMeta[] = [
  {
    key: "client",
    group: "clientOrder",
    type: "builtin",
    canHide: false,
    canRequire: false,
    canRename: true,
    appliesTo: always,
    defaultLabel: () => i18n.t("orders.form.clientLabel"),
    defaultRequired: () => true,
    defaultSortOrder: 10,
  },
  {
    key: "vehicle",
    group: "asset",
    type: "builtin",
    canHide: false,
    canRequire: true,
    canRename: true,
    appliesTo: vehiclesOnly,
    defaultLabel: () => i18n.t("vehicles.selectLabel"),
    defaultRequired: () => false,
    defaultSortOrder: 20,
  },
  {
    key: "vehicleMake",
    group: "asset",
    type: "text",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: vehiclesOnly,
    defaultLabel: () => i18n.t("vehicles.fields.make"),
    defaultRequired: () => false,
    defaultSortOrder: 21,
  },
  {
    key: "vehicleModel",
    group: "asset",
    type: "text",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: vehiclesOnly,
    defaultLabel: () => i18n.t("vehicles.fields.model"),
    defaultRequired: () => false,
    defaultSortOrder: 22,
  },
  {
    key: "vehicleYear",
    group: "asset",
    type: "number",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: vehiclesOnly,
    defaultLabel: () => i18n.t("vehicles.fields.year"),
    defaultRequired: () => false,
    defaultSortOrder: 23,
  },
  {
    key: "vehicleLicensePlate",
    group: "asset",
    type: "text",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: vehiclesOnly,
    defaultLabel: () => i18n.t("vehicles.fields.licensePlate"),
    defaultRequired: () => false,
    defaultSortOrder: 24,
  },
  {
    key: "vehicleVin",
    group: "asset",
    type: "text",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: vehiclesOnly,
    defaultLabel: () => i18n.t("vehicles.fields.vin"),
    defaultRequired: () => false,
    defaultSortOrder: 25,
  },
  {
    key: "vehicleInitialMileage",
    group: "asset",
    type: "number",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: vehiclesOnly,
    defaultLabel: () => i18n.t("vehicles.fields.initialMileage"),
    defaultRequired: () => false,
    defaultSortOrder: 26,
  },
  {
    key: "vehicleCurrentMileage",
    group: "asset",
    type: "number",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: vehiclesOnly,
    defaultLabel: () => i18n.t("vehicles.fields.orderCurrentMileage"),
    defaultRequired: () => false,
    defaultSortOrder: 27,
  },
  {
    key: "vehicleEngineDisplacement",
    group: "asset",
    type: "text",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: vehiclesOnly,
    defaultLabel: () => i18n.t("vehicles.fields.engineDisplacement"),
    defaultRequired: () => false,
    defaultSortOrder: 28,
  },
  {
    key: "vehicleFuelType",
    group: "asset",
    type: "select",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: vehiclesOnly,
    defaultLabel: () => i18n.t("vehicles.fields.fuelType"),
    defaultRequired: () => false,
    defaultSortOrder: 29,
  },
  {
    key: "device",
    group: "asset",
    type: "text",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: (p) => assetVisible(p, "device"),
    defaultLabel: (w) => industryOrderCopy(w).deviceLabel,
    defaultRequired: (p) => assetRequired(p, "device"),
    defaultSortOrder: 20,
  },
  {
    key: "carNumber",
    group: "asset",
    type: "text",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: (p) => assetVisible(p, "carNumber"),
    defaultLabel: (w) => industryOrderCopy(w).carNumberLabel,
    defaultRequired: (p) => assetRequired(p, "carNumber"),
    defaultSortOrder: 30,
  },
  {
    key: "vin",
    group: "asset",
    type: "text",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: (p) => assetVisible(p, "vin"),
    defaultLabel: (w) => industryOrderCopy(w).vinLabel,
    defaultRequired: (p) => assetRequired(p, "vin"),
    defaultSortOrder: 40,
  },
  {
    key: "deviceSerial",
    group: "asset",
    type: "text",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: (p) => blockOn(p.orderFieldBlocks, "deviceSerial"),
    defaultLabel: () => i18n.t("orders.industryFields.deviceSerial"),
    defaultRequired: () => false,
    defaultSortOrder: 50,
  },
  {
    key: "deviceImei",
    group: "asset",
    type: "text",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: (p) => blockOn(p.orderFieldBlocks, "deviceImei"),
    defaultLabel: () => i18n.t("orders.industryFields.deviceImei"),
    defaultRequired: () => false,
    defaultSortOrder: 60,
  },
  {
    key: "deviceCondition",
    group: "asset",
    type: "textarea",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: (p) => blockOn(p.orderFieldBlocks, "deviceCondition"),
    defaultLabel: () => i18n.t("orders.industryFields.deviceCondition"),
    defaultRequired: () => false,
    defaultSortOrder: 70,
  },
  {
    key: "deviceCompleteness",
    group: "asset",
    type: "textarea",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: (p) => blockOn(p.orderFieldBlocks, "deviceCompleteness"),
    defaultLabel: () => i18n.t("orders.industryFields.deviceCompleteness"),
    defaultRequired: () => false,
    defaultSortOrder: 80,
  },
  {
    key: "devicePasscode",
    group: "asset",
    type: "text",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: (p) => blockOn(p.orderFieldBlocks, "devicePasscode"),
    defaultLabel: () => i18n.t("orders.industryFields.devicePasscode"),
    defaultRequired: () => false,
    defaultSortOrder: 90,
  },
  {
    key: "siteAddress",
    group: "asset",
    type: "text",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: (p) => blockOn(p.orderFieldBlocks, "siteAddress"),
    defaultLabel: () => i18n.t("orders.industryFields.siteAddress"),
    defaultRequired: () => false,
    defaultSortOrder: 100,
  },
  {
    key: "productDimensions",
    group: "asset",
    type: "text",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: (p) => blockOn(p.orderFieldBlocks, "productDimensions"),
    defaultLabel: () => i18n.t("orders.industryFields.productDimensions"),
    defaultRequired: () => false,
    defaultSortOrder: 110,
  },
  {
    key: "measurementAt",
    group: "asset",
    type: "datetime",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: (p) => blockOn(p.orderFieldBlocks, "measurementAt"),
    defaultLabel: () => i18n.t("orders.industryFields.measurementAt"),
    defaultRequired: () => false,
    defaultSortOrder: 120,
  },
  {
    key: "installationAt",
    group: "asset",
    type: "datetime",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: (p) => blockOn(p.orderFieldBlocks, "installationAt"),
    defaultLabel: () => i18n.t("orders.industryFields.installationAt"),
    defaultRequired: () => false,
    defaultSortOrder: 130,
  },
  {
    key: "description",
    group: "clientOrder",
    type: "textarea",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: always,
    defaultLabel: () => i18n.t("orders.form.descriptionLabel"),
    defaultRequired: () => false,
    defaultSortOrder: 140,
  },
  {
    key: "assignedEmployee",
    group: "clientOrder",
    type: "builtin",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: always,
    defaultLabel: (w) => industryOrderCopy(w).assignedEmployeeLabel,
    defaultRequired: () => false,
    defaultSortOrder: 150,
  },
  {
    key: "team",
    group: "clientOrder",
    type: "builtin",
    canHide: true,
    canRequire: false,
    canRename: true,
    appliesTo: always,
    defaultLabel: () => i18n.t("orders.team.title"),
    defaultRequired: () => false,
    defaultSortOrder: 160,
  },
  {
    key: "services",
    group: "work",
    type: "builtin",
    canHide: false,
    canRequire: false,
    canRename: true,
    appliesTo: always,
    defaultLabel: (w) => industryOrderCopy(w).serviceLabel,
    defaultRequired: () => false,
    defaultSortOrder: 170,
  },
  {
    key: "materials",
    group: "work",
    type: "builtin",
    canHide: true,
    canRequire: false,
    canRename: true,
    appliesTo: always,
    defaultLabel: () => i18n.t("orders.form.materialsSection"),
    defaultRequired: () => false,
    defaultSortOrder: 180,
  },
  {
    key: "deadline",
    group: "clientOrder",
    type: "date",
    canHide: true,
    canRequire: true,
    canRename: true,
    appliesTo: always,
    defaultLabel: (w) => industryOrderCopy(w).deadlineLabel,
    defaultRequired: () => false,
    defaultSortOrder: 190,
  },
  {
    key: "status",
    group: "clientOrder",
    type: "builtin",
    canHide: false,
    canRequire: false,
    canRename: true,
    appliesTo: always,
    defaultLabel: () => i18n.t("common.status"),
    defaultRequired: () => true,
    defaultSortOrder: 200,
  },
  {
    key: "total",
    group: "clientOrder",
    type: "builtin",
    canHide: false,
    canRequire: false,
    canRename: true,
    appliesTo: always,
    defaultLabel: () => i18n.t("common.total"),
    defaultRequired: () => false,
    defaultSortOrder: 210,
  },
];

export function builtinOrderFieldMeta(key: string): BuiltinOrderFieldMeta | undefined {
  return BUILTIN_ORDER_FIELDS.find((field) => field.key === key);
}

/** Settings group title for the asset block (transport / device / object). */
export function orderFieldAssetGroupLabel(profile: IndustryProfile): string {
  if (profile.navigation.clientVehicles || profile.assetKind === "vehicle") {
    return i18n.t("settings.orderFields.groups.transport");
  }
  if (profile.assetKind === "device") {
    return i18n.t("settings.orderFields.groups.device");
  }
  if (profile.assetKind === "site" || profile.assetKind === "project") {
    return i18n.t("settings.orderFields.groups.object");
  }
  return i18n.t("settings.orderFields.groups.device");
}

export function orderFieldGroupLabel(group: OrderFieldGroup, profile: IndustryProfile): string {
  if (group === "asset") return orderFieldAssetGroupLabel(profile);
  if (group === "clientOrder") return i18n.t("settings.orderFields.groups.clientOrder");
  if (group === "work") return i18n.t("settings.orderFields.groups.work");
  return i18n.t("settings.orderFields.groups.custom");
}

/** Slug from a custom field label (unique per workspace when combined with uniqueness check). */
export function slugifyOrderFieldKey(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return base || `field_${Date.now().toString(36)}`;
}

export function customEditFieldKey(fieldKey: string): `custom:${string}` {
  return `custom:${fieldKey}`;
}

export function parseCustomEditField(field: string): string | null {
  if (!field.startsWith("custom:")) return null;
  const key = field.slice("custom:".length).trim();
  return key || null;
}
