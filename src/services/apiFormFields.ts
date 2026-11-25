import type { FormEntity, FormFieldOverrides } from "../features/formFields/formFieldRegistry";
import { FORM_ENTITIES } from "../features/formFields/formFieldRegistry";
import { isMissingTableError, requireWorkspaceId } from "./missingTable";
import supabase from "./supabase";

/** module_settings key holding one form's field overrides. */
export function formFieldsSettingKey(entity: FormEntity) {
  return `form_fields.${entity}`;
}

export type AllFormFieldOverrides = Record<FormEntity, FormFieldOverrides>;

function emptyOverrides(): AllFormFieldOverrides {
  return { client: {}, service: {}, product: {} };
}

function asOverrides(value: unknown): FormFieldOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: FormFieldOverrides = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    out[key] = {
      ...(typeof row.label === "string" && row.label.trim() ? { label: row.label.trim().slice(0, 80) } : {}),
      ...(row.hidden === true ? { hidden: true } : {}),
      ...(typeof row.order === "number" && Number.isFinite(row.order) ? { order: row.order } : {}),
    };
  }
  return out;
}

/** All three forms in one request. Missing table (DB without the CRM schema) → defaults everywhere. */
export async function getFormFieldOverrides(workspaceId: string | undefined): Promise<AllFormFieldOverrides> {
  const ws = requireWorkspaceId(workspaceId);
  const { data, error } = await supabase
    .from("module_settings")
    .select("key, value")
    .eq("workspace_id", ws)
    .in(
      "key",
      FORM_ENTITIES.map((entity) => formFieldsSettingKey(entity)),
    );
  if (error) {
    if (isMissingTableError(error, "module_settings")) return emptyOverrides();
    throw new Error(error.message);
  }
  const result = emptyOverrides();
  for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
    const entity = FORM_ENTITIES.find((candidate) => formFieldsSettingKey(candidate) === row.key);
    if (entity) result[entity] = asOverrides(row.value);
  }
  return result;
}

/** Replaces one form's overrides (single upsert). */
export async function saveFormFieldOverrides(
  workspaceId: string | undefined,
  entity: FormEntity,
  overrides: FormFieldOverrides,
): Promise<void> {
  const ws = requireWorkspaceId(workspaceId);
  const { error } = await supabase.from("module_settings").upsert(
    {
      workspace_id: ws,
      key: formFieldsSettingKey(entity),
      value: asOverrides(overrides),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,key" },
  );
  if (error) throw new Error(error.message);
}
