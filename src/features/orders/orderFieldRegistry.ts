import type { IndustryOrderFieldBlocks, IndustryProfile } from "../industries/industryProfile";
import { industryOrderCopy, type IndustryWorkflow } from "../industries/industryWorkflow";
import i18n from "../../i18n";

/** Built-in order field keys that can be overridden via custom_field_definitions (is_system). */
export const BUILTIN_ORDER_FIELD_KEYS = [
  "client",
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

function assetVisible(profile: IndustryProfile, name: "device" | "carNumber" | "vin") {
  return profile.orderFields[name].visible;
}

function assetRequired(profile: IndustryProfile, name: "device" | "carNumber" | "vin") {
  return profile.orderFields[name].visible && profile.orderFields[name].required;
}

/** Single registry of built-in order fields. */
export const BUILTIN_ORDER_FIELDS: readonly BuiltinOrderFieldMeta[] = [
  {
    key: "client",
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
    key: "device",
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
