/**
 * Configurable input forms (clients, services, products): which fields exist, which may be hidden or renamed.
 *
 * Renaming only changes the text the user sees — the app always works with the field key, so a new name never
 * changes logic. Fields the app's logic depends on (prices, stock, warranty, duplicate checks, client type…)
 * cannot be hidden: a hidden input would save a default value and quietly break calculations.
 */

export type FormEntity = "client" | "service" | "product";

export const FORM_ENTITIES: readonly FormEntity[] = ["client", "service", "product"];

export type FormFieldMeta = {
  key: string;
  /** May be switched off in the form. */
  canHide: boolean;
  /** The label may be replaced (false for composite blocks with several labels inside). */
  canRename: boolean;
  /** Why the field is protected — shown next to it in settings. */
  lock?: "system" | "logic";
  /** Takes the full row in two-column forms. */
  wide?: boolean;
};

export const FORM_FIELDS: Record<FormEntity, readonly FormFieldMeta[]> = {
  client: [
    { key: "clientType", canHide: false, canRename: true, lock: "system" },
    { key: "clientName", canHide: false, canRename: true, lock: "system" },
    { key: "middleName", canHide: true, canRename: true },
    { key: "taxId", canHide: true, canRename: true },
    { key: "contactPerson", canHide: true, canRename: true },
    { key: "phone", canHide: false, canRename: true, lock: "logic" },
    { key: "address", canHide: true, canRename: true },
    { key: "notes", canHide: true, canRename: true },
    { key: "consents", canHide: false, canRename: false, lock: "logic" },
  ],
  service: [
    { key: "serviceName", canHide: false, canRename: true, lock: "system", wide: true },
    { key: "category", canHide: false, canRename: true, lock: "system" },
    { key: "status", canHide: false, canRename: true, lock: "system" },
    { key: "price", canHide: false, canRename: true, lock: "logic", wide: true },
    { key: "description", canHide: true, canRename: true, wide: true },
    { key: "defaultTechnician", canHide: true, canRename: true, wide: true },
    { key: "warranty", canHide: false, canRename: false, lock: "logic", wide: true },
  ],
  product: [
    { key: "name", canHide: false, canRename: true, lock: "system", wide: true },
    { key: "sku", canHide: true, canRename: true },
    { key: "category", canHide: true, canRename: true },
    { key: "description", canHide: true, canRename: true, wide: true },
    { key: "quantity", canHide: false, canRename: true, lock: "logic" },
    { key: "minQuantity", canHide: false, canRename: true, lock: "logic" },
    { key: "unit", canHide: false, canRename: true, lock: "logic", wide: true },
    { key: "markup", canHide: false, canRename: true, lock: "logic", wide: true },
    { key: "purchasePrice", canHide: false, canRename: true, lock: "logic" },
    { key: "sellingPrice", canHide: false, canRename: true, lock: "logic" },
    { key: "supplier", canHide: true, canRename: true },
    { key: "location", canHide: true, canRename: true },
    { key: "isActive", canHide: false, canRename: true, lock: "system", wide: true },
    { key: "warranty", canHide: false, canRename: false, lock: "logic", wide: true },
  ],
};

export function formFieldMeta(entity: FormEntity, key: string): FormFieldMeta | undefined {
  return FORM_FIELDS[entity].find((field) => field.key === key);
}

/** What the workspace stored for one field. Missing keys mean «default». */
export type FormFieldOverride = { label?: string; hidden?: boolean; order?: number };

export type FormFieldOverrides = Record<string, FormFieldOverride>;

export type ResolvedFormField = FormFieldMeta & {
  /** Custom label, or null when the form's own default text applies. */
  customLabel: string | null;
  visible: boolean;
  order: number;
};

/** Registry + stored overrides → fields in display order. Unknown stored keys are ignored. */
export function resolveFormFields(entity: FormEntity, overrides: FormFieldOverrides | null | undefined): ResolvedFormField[] {
  return FORM_FIELDS[entity]
    .map((meta, index) => {
      const override = overrides?.[meta.key];
      const label = meta.canRename ? override?.label?.trim() ?? "" : "";
      return {
        ...meta,
        customLabel: label || null,
        visible: meta.canHide ? override?.hidden !== true : true,
        order: typeof override?.order === "number" && Number.isFinite(override.order) ? override.order : (index + 1) * 10,
      };
    })
    .sort((a, b) => a.order - b.order);
}
