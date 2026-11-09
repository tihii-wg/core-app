import type { IndustryProfile } from "../industries/industryProfile";
import { industryWorkflow, type IndustryWorkflow } from "../industries/industryWorkflow";
import {
  BUILTIN_ORDER_FIELDS,
  builtinOrderFieldMeta,
  LEGACY_ASSET_TO_VEHICLE_FIELD,
  type BuiltinOrderFieldKey,
  type OrderFieldGroup,
  type OrderFieldType,
} from "./orderFieldRegistry";

export type CustomFieldSelectOption = { value: string; label: string };

export type CustomFieldDefinitionRow = {
  id: string;
  workspaceId: string;
  entity: string;
  orderTypeId: string | null;
  fieldKey: string;
  label: string;
  fieldType: OrderFieldType;
  options: CustomFieldSelectOption[];
  defaultValue: unknown;
  templateVariable: string | null;
  isSystem: boolean;
  isRequired: boolean;
  showOnCard: boolean;
  readOnlyAfterCreate: boolean;
  sortOrder: number;
  isActive: boolean;
  deletedAt: string | null;
};

/** Merged field entry consumed by forms, detail, list, settings. */
export type OrderFieldConfigItem = {
  key: string;
  label: string;
  visible: boolean;
  required: boolean;
  isCustom: boolean;
  isSystem: boolean;
  type: OrderFieldType;
  options: CustomFieldSelectOption[];
  definitionId: string | null;
  sortOrder: number;
  canHide: boolean;
  canRequire: boolean;
  canRename: boolean;
  group: OrderFieldGroup;
  /** Industry default label (for reset). */
  defaultLabel: string;
  defaultVisible: boolean;
  defaultRequired: boolean;
  defaultSortOrder: number;
  /** Soft-deleted custom field (settings archived list only). */
  archived?: boolean;
};

export type MergeOrderFieldConfigInput = {
  profile: IndustryProfile;
  workflow?: IndustryWorkflow;
  definitions: CustomFieldDefinitionRow[];
};

function asOptions(raw: unknown): CustomFieldSelectOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const value = String(row.value ?? row.id ?? "").trim();
      const label = String(row.label ?? value).trim();
      if (!value) return null;
      return { value, label: label || value };
    })
    .filter((entry): entry is CustomFieldSelectOption => Boolean(entry));
}

/**
 * Merge industry defaults + system overrides + custom fields into one ordered list.
 * Built-ins that do not apply to the industry are omitted (overrides kept in DB for later).
 * Soft-deleted custom fields are returned with `archived: true` and not in the main list —
 * callers that need them use `archivedCustomFields` separately.
 */
export function mergeOrderFieldConfig(input: MergeOrderFieldConfigInput): {
  fields: OrderFieldConfigItem[];
  archivedCustomFields: OrderFieldConfigItem[];
} {
  const workflow = input.workflow ?? industryWorkflow(input.profile.slug);
  const profile = input.profile;

  const systemByKey = new Map<string, CustomFieldDefinitionRow>();
  const customActive: CustomFieldDefinitionRow[] = [];
  const customArchived: CustomFieldDefinitionRow[] = [];

  for (const def of input.definitions) {
    if (def.entity !== "order") continue;
    if (def.isSystem) {
      systemByKey.set(def.fieldKey, def);
      continue;
    }
    if (def.deletedAt) customArchived.push(def);
    else customActive.push(def);
  }

  const fields: OrderFieldConfigItem[] = [];
  const usesVehicles = Boolean(profile.navigation.clientVehicles);

  for (const meta of BUILTIN_ORDER_FIELDS) {
    if (!meta.appliesTo(profile)) continue;
    let override = systemByKey.get(meta.key) ?? null;
    // Read-time migration: legacy device/carNumber/vin overrides → vehicle* when no vehicle override exists.
    if (!override && usesVehicles) {
      for (const [legacyKey, vehicleKey] of Object.entries(LEGACY_ASSET_TO_VEHICLE_FIELD)) {
        if (vehicleKey === meta.key && systemByKey.has(legacyKey) && !systemByKey.has(meta.key)) {
          override = systemByKey.get(legacyKey) ?? null;
          break;
        }
      }
    }
    const defaultLabel = meta.defaultLabel(workflow);
    const defaultRequired = meta.defaultRequired(profile);
    const defaultVisible = true;
    const defaultSortOrder = meta.defaultSortOrder;

    const visible = meta.canHide ? (override ? Boolean(override.isActive) : defaultVisible) : true;
    const required = meta.canRequire ? (override ? Boolean(override.isRequired) : defaultRequired) : defaultRequired;
    const label = meta.canRename && override?.label?.trim() ? override.label.trim() : defaultLabel;
    const sortOrder = override ? override.sortOrder : defaultSortOrder;

    fields.push({
      key: meta.key,
      label,
      visible,
      required,
      isCustom: false,
      isSystem: true,
      type: meta.type,
      options: [],
      definitionId: override?.id ?? null,
      sortOrder,
      canHide: meta.canHide,
      canRequire: meta.canRequire,
      canRename: meta.canRename,
      group: meta.group,
      defaultLabel,
      defaultVisible,
      defaultRequired,
      defaultSortOrder,
    });
  }

  for (const def of customActive) {
    fields.push({
      key: def.fieldKey,
      label: def.label.trim() || def.fieldKey,
      visible: Boolean(def.isActive),
      required: Boolean(def.isRequired),
      isCustom: true,
      isSystem: false,
      type: def.fieldType,
      options: asOptions(def.options),
      definitionId: def.id,
      sortOrder: def.sortOrder,
      canHide: true,
      canRequire: true,
      canRename: true,
      group: "custom",
      defaultLabel: def.label,
      defaultVisible: true,
      defaultRequired: false,
      defaultSortOrder: def.sortOrder,
    });
  }

  fields.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));

  const archivedCustomFields: OrderFieldConfigItem[] = customArchived.map((def) => ({
    key: def.fieldKey,
    label: def.label.trim() || def.fieldKey,
    visible: false,
    required: false,
    isCustom: true,
    isSystem: false,
    type: def.fieldType,
    options: asOptions(def.options),
    definitionId: def.id,
    sortOrder: def.sortOrder,
    canHide: true,
    canRequire: true,
    canRename: true,
    group: "custom" as const,
    defaultLabel: def.label,
    defaultVisible: false,
    defaultRequired: false,
    defaultSortOrder: def.sortOrder,
    archived: true,
  }));

  return { fields, archivedCustomFields };
}

export function orderFieldByKey(fields: OrderFieldConfigItem[], key: string): OrderFieldConfigItem | undefined {
  return fields.find((field) => field.key === key);
}

export function visibleOrderFields(fields: OrderFieldConfigItem[]): OrderFieldConfigItem[] {
  return fields.filter((field) => field.visible);
}

export function isBuiltinOrderFieldKey(key: string): key is BuiltinOrderFieldKey {
  return Boolean(builtinOrderFieldMeta(key));
}

export function customOrderFields(fields: OrderFieldConfigItem[]): OrderFieldConfigItem[] {
  return fields.filter((field) => field.isCustom && field.visible);
}
