import i18n from "../i18n";
import type { CustomFieldDefinitionRow, CustomFieldSelectOption } from "../features/orders/orderFieldConfig";
import type { OrderFieldType } from "../features/orders/orderFieldRegistry";
import { isMissingTableError } from "./missingTable";
import supabase from "./supabase";

export type CustomFieldEntity = "order" | "estimate" | "lead" | "client_person" | "client_organization" | "product" | "vehicle";

export type CustomFieldValueRow = {
  id: string;
  workspaceId: string;
  definitionId: string;
  entityId: string;
  value: unknown;
};

export class CustomFieldsUnavailableError extends Error {
  constructor(message = i18n.t("settings.orderFields.errors.unavailable")) {
    super(message);
    this.name = "CustomFieldsUnavailableError";
  }
}

function requireWorkspaceId(workspaceId: string | undefined) {
  const id = workspaceId?.trim() ?? "";
  if (!id) throw new Error(i18n.t("common.errors.noActiveWorkspace"));
  return id;
}

function asOptions(raw: unknown): CustomFieldSelectOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const value = String(row.value ?? "").trim();
      const label = String(row.label ?? value).trim();
      if (!value) return null;
      return { value, label: label || value };
    })
    .filter((entry): entry is CustomFieldSelectOption => Boolean(entry));
}

function toDefinition(row: Record<string, unknown>): CustomFieldDefinitionRow {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    entity: String(row.entity ?? "order"),
    orderTypeId: typeof row.order_type_id === "string" ? row.order_type_id : null,
    fieldKey: String(row.field_key ?? ""),
    label: String(row.label ?? ""),
    fieldType: String(row.field_type ?? "text") as OrderFieldType,
    options: asOptions(row.options),
    defaultValue: row.default_value ?? null,
    templateVariable: typeof row.template_variable === "string" ? row.template_variable : null,
    isSystem: Boolean(row.is_system),
    isRequired: Boolean(row.is_required),
    showOnCard: Boolean(row.show_on_card),
    readOnlyAfterCreate: Boolean(row.read_only_after_create),
    sortOrder: Number(row.sort_order ?? 0),
    isActive: row.is_active !== false,
    deletedAt: typeof row.deleted_at === "string" ? row.deleted_at : null,
  };
}

function toValue(row: Record<string, unknown>): CustomFieldValueRow {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    definitionId: String(row.definition_id),
    entityId: String(row.entity_id),
    value: row.value ?? null,
  };
}

const definitionColumns =
  "id, workspace_id, entity, order_type_id, field_key, label, field_type, options, default_value, template_variable, is_system, is_required, show_on_card, read_only_after_create, sort_order, is_active, deleted_at";

/** Active + soft-deleted order field definitions for a workspace. */
export async function getOrderFieldDefinitions(workspaceId: string | undefined): Promise<CustomFieldDefinitionRow[]> {
  const ws = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("custom_field_definitions")
    .select(definitionColumns)
    .eq("workspace_id", ws)
    .eq("entity", "order")
    .order("sort_order", { ascending: true });

  if (error) {
    if (isMissingTableError(error) || error.code === "PGRST205" || error.code === "42P01") {
      throw new CustomFieldsUnavailableError();
    }
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toDefinition);
}

export type UpsertSystemOrderFieldOverrideInput = {
  fieldKey: string;
  label: string;
  isActive: boolean;
  isRequired: boolean;
  sortOrder: number;
  fieldType?: OrderFieldType;
};

/** Create or update a system override row for a built-in order field. */
export async function upsertSystemOrderFieldOverride(
  workspaceId: string | undefined,
  input: UpsertSystemOrderFieldOverrideInput,
): Promise<CustomFieldDefinitionRow> {
  const ws = requireWorkspaceId(workspaceId);
  const fieldKey = input.fieldKey.trim();
  if (!fieldKey) throw new Error(i18n.t("settings.orderFields.errors.keyRequired"));

  const { data: existing, error: findError } = await supabase
    .from("custom_field_definitions")
    .select(definitionColumns)
    .eq("workspace_id", ws)
    .eq("entity", "order")
    .eq("field_key", fieldKey)
    .eq("is_system", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (findError) throw new Error(findError.message);

  const payload = {
    // Empty label = no rename; the UI falls back to the industry default label.
    label: input.label.trim(),
    is_active: input.isActive,
    is_required: input.isRequired,
    sort_order: input.sortOrder,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { data, error } = await supabase
      .from("custom_field_definitions")
      .update(payload)
      .eq("id", existing.id)
      .eq("workspace_id", ws)
      .select(definitionColumns)
      .single();
    if (error) throw new Error(error.message);
    return toDefinition(data as Record<string, unknown>);
  }

  const { data, error } = await supabase
    .from("custom_field_definitions")
    .insert({
      workspace_id: ws,
      entity: "order",
      field_key: fieldKey,
      label: payload.label,
      field_type: input.fieldType ?? "text",
      options: [],
      is_system: true,
      is_required: input.isRequired,
      is_active: input.isActive,
      sort_order: input.sortOrder,
      show_on_card: false,
      read_only_after_create: false,
    })
    .select(definitionColumns)
    .single();
  if (error) throw new Error(error.message);
  return toDefinition(data as Record<string, unknown>);
}

export type CreateCustomOrderFieldInput = {
  fieldKey: string;
  label: string;
  fieldType: OrderFieldType;
  options?: CustomFieldSelectOption[];
  isRequired?: boolean;
  sortOrder?: number;
};

export async function createCustomOrderField(
  workspaceId: string | undefined,
  input: CreateCustomOrderFieldInput,
): Promise<CustomFieldDefinitionRow> {
  const ws = requireWorkspaceId(workspaceId);
  const fieldKey = input.fieldKey.trim();
  const label = input.label.trim();
  if (!fieldKey) throw new Error(i18n.t("settings.orderFields.errors.keyRequired"));
  if (!label) throw new Error(i18n.t("settings.orderFields.errors.labelRequired"));

  const { data, error } = await supabase
    .from("custom_field_definitions")
    .insert({
      workspace_id: ws,
      entity: "order",
      field_key: fieldKey,
      label,
      field_type: input.fieldType,
      options: input.options ?? [],
      is_system: false,
      is_required: Boolean(input.isRequired),
      is_active: true,
      sort_order: input.sortOrder ?? 500,
      show_on_card: true,
      read_only_after_create: false,
      template_variable: `order.custom.${fieldKey}`,
    })
    .select(definitionColumns)
    .single();

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      throw new Error(i18n.t("settings.orderFields.errors.duplicateKey"));
    }
    throw new Error(error.message);
  }
  return toDefinition(data as Record<string, unknown>);
}

export type UpdateCustomOrderFieldInput = {
  definitionId: string;
  label?: string;
  isActive?: boolean;
  isRequired?: boolean;
  sortOrder?: number;
  options?: CustomFieldSelectOption[];
  fieldType?: OrderFieldType;
};

export async function updateCustomOrderField(
  workspaceId: string | undefined,
  input: UpdateCustomOrderFieldInput,
): Promise<CustomFieldDefinitionRow> {
  const ws = requireWorkspaceId(workspaceId);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.label != null) patch.label = input.label.trim();
  if (input.isActive != null) patch.is_active = input.isActive;
  if (input.isRequired != null) patch.is_required = input.isRequired;
  if (input.sortOrder != null) patch.sort_order = input.sortOrder;
  if (input.options != null) patch.options = input.options;
  if (input.fieldType != null) patch.field_type = input.fieldType;

  const { data, error } = await supabase
    .from("custom_field_definitions")
    .update(patch)
    .eq("id", input.definitionId)
    .eq("workspace_id", ws)
    .is("deleted_at", null)
    .select(definitionColumns)
    .single();
  if (error) throw new Error(error.message);
  return toDefinition(data as Record<string, unknown>);
}

/** Soft-delete a custom (non-system) field definition. */
export async function softDeleteCustomOrderField(workspaceId: string | undefined, definitionId: string) {
  const ws = requireWorkspaceId(workspaceId);
  const { error } = await supabase
    .from("custom_field_definitions")
    .update({ deleted_at: new Date().toISOString(), is_active: false, updated_at: new Date().toISOString() })
    .eq("id", definitionId)
    .eq("workspace_id", ws)
    .eq("is_system", false)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
}

/** Delete system override row(s) so industry defaults apply again. */
export async function resetSystemOrderFieldOverride(workspaceId: string | undefined, fieldKey: string) {
  const ws = requireWorkspaceId(workspaceId);
  const { error } = await supabase
    .from("custom_field_definitions")
    .delete()
    .eq("workspace_id", ws)
    .eq("entity", "order")
    .eq("field_key", fieldKey.trim())
    .eq("is_system", true);
  if (error) throw new Error(error.message);
}

export async function resetAllSystemOrderFieldOverrides(workspaceId: string | undefined) {
  const ws = requireWorkspaceId(workspaceId);
  const { error } = await supabase
    .from("custom_field_definitions")
    .delete()
    .eq("workspace_id", ws)
    .eq("entity", "order")
    .eq("is_system", true);
  if (error) throw new Error(error.message);
}

export async function getCustomFieldValuesForEntity(
  workspaceId: string | undefined,
  entityId: string,
): Promise<CustomFieldValueRow[]> {
  const ws = requireWorkspaceId(workspaceId);
  const id = entityId.trim();
  if (!id) return [];

  const { data, error } = await supabase
    .from("custom_field_values")
    .select("id, workspace_id, definition_id, entity_id, value")
    .eq("workspace_id", ws)
    .eq("entity_id", id);

  if (error) {
    if (isMissingTableError(error) || error.code === "PGRST205" || error.code === "42P01") {
      return [];
    }
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toValue);
}

/** Load custom field values for many orders (search / export). */
export async function getCustomFieldValuesForEntities(
  workspaceId: string | undefined,
  entityIds: string[],
): Promise<CustomFieldValueRow[]> {
  const ws = requireWorkspaceId(workspaceId);
  const ids = [...new Set(entityIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("custom_field_values")
    .select("id, workspace_id, definition_id, entity_id, value")
    .eq("workspace_id", ws)
    .in("entity_id", ids);

  if (error) {
    if (isMissingTableError(error) || error.code === "PGRST205" || error.code === "42P01") {
      return [];
    }
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toValue);
}

export type UpsertCustomFieldValueInput = {
  definitionId: string;
  entityId: string;
  value: unknown;
};

/** Upsert one value; fails loudly (caller must not drop silently). */
export async function upsertCustomFieldValue(
  workspaceId: string | undefined,
  input: UpsertCustomFieldValueInput,
): Promise<CustomFieldValueRow> {
  const ws = requireWorkspaceId(workspaceId);
  const definitionId = input.definitionId.trim();
  const entityId = input.entityId.trim();
  if (!definitionId || !entityId) throw new Error(i18n.t("settings.orderFields.errors.valueSaveFailed"));

  const { data: existing, error: findError } = await supabase
    .from("custom_field_values")
    .select("id")
    .eq("definition_id", definitionId)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (findError) throw new Error(findError.message);

  if (existing?.id) {
    const { data, error } = await supabase
      .from("custom_field_values")
      .update({ value: input.value ?? null, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("workspace_id", ws)
      .select("id, workspace_id, definition_id, entity_id, value")
      .single();
    if (error) throw new Error(error.message);
    return toValue(data as Record<string, unknown>);
  }

  const { data, error } = await supabase
    .from("custom_field_values")
    .insert({
      workspace_id: ws,
      definition_id: definitionId,
      entity_id: entityId,
      value: input.value ?? null,
    })
    .select("id, workspace_id, definition_id, entity_id, value")
    .single();
  if (error) throw new Error(error.message);
  return toValue(data as Record<string, unknown>);
}

export async function upsertCustomFieldValues(
  workspaceId: string | undefined,
  entityId: string,
  values: Array<{ definitionId: string; value: unknown }>,
) {
  for (const entry of values) {
    await upsertCustomFieldValue(workspaceId, {
      definitionId: entry.definitionId,
      entityId,
      value: entry.value,
    });
  }
}

/** Serialize a form value to jsonb-friendly payload. */
export function serializeCustomFieldValue(type: OrderFieldType, raw: unknown): unknown {
  if (raw == null || raw === "") return null;
  if (type === "checkbox") return Boolean(raw);
  if (type === "number") {
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (type === "select" || type === "text" || type === "textarea" || type === "date" || type === "datetime") {
    return String(raw);
  }
  return raw;
}

export function displayCustomFieldValue(type: OrderFieldType, value: unknown, options: CustomFieldSelectOption[] = []): string {
  if (value == null || value === "") return "";
  if (type === "checkbox") return value === true || value === "true" ? "✓" : "";
  if (type === "select") {
    const str = String(value);
    return options.find((opt) => opt.value === str)?.label ?? str;
  }
  return String(value);
}
