import { useTranslation } from "react-i18next";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Textarea } from "../../ui/Textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import type { OrderFieldConfigItem } from "./orderFieldConfig";
import { customEditFieldKey } from "./orderFieldRegistry";

/** Custom field values keyed by field_key (not form path). */
export type OrderCustomFieldValues = Record<string, string | boolean | number | null | undefined>;

export function customFieldFormName(fieldKey: string): string {
  return fieldKey;
}

export function collectCustomFieldPayload(
  fields: OrderFieldConfigItem[],
  values: OrderCustomFieldValues,
): Array<{ definitionId: string; value: unknown }> {
  const out: Array<{ definitionId: string; value: unknown }> = [];
  for (const field of fields) {
    if (!field.isCustom || !field.visible || !field.definitionId) continue;
    const raw = values[field.key];
    let value: unknown = raw ?? null;
    if (field.type === "checkbox") value = Boolean(raw);
    if (field.type === "number" && raw !== "" && raw != null) {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
      value = Number.isFinite(n) ? n : null;
    }
    if ((field.type === "text" || field.type === "textarea" || field.type === "date" || field.type === "datetime" || field.type === "select") && raw === "") {
      value = null;
    }
    out.push({ definitionId: field.definitionId, value });
  }
  return out;
}

export function validateRequiredCustomFields(
  fields: OrderFieldConfigItem[],
  values: OrderCustomFieldValues,
  requiredMessage: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (!field.isCustom || !field.visible || !field.required) continue;
    const raw = values[field.key];
    const empty =
      field.type === "checkbox"
        ? raw !== true && raw !== "true"
        : raw == null || String(raw).trim() === "";
    if (empty) errors[field.key] = requiredMessage;
  }
  return errors;
}

type OrderCustomFieldsProps = {
  fields: OrderFieldConfigItem[];
  values: OrderCustomFieldValues;
  onChange: (fieldKey: string, value: string | boolean | number | null) => void;
  errors?: Record<string, string>;
  idPrefix?: string;
  disabled?: boolean;
};

/** Renders visible custom order fields (text/textarea/number/date/datetime/select/checkbox). */
export function OrderCustomFields({
  fields,
  values,
  onChange,
  errors = {},
  idPrefix = "",
  disabled = false,
}: OrderCustomFieldsProps) {
  const { t } = useTranslation();
  const custom = fields.filter((field) => field.isCustom && field.visible);
  if (custom.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="order-custom-fields">
      {custom.map((field) => {
        const id = `${idPrefix}custom_${field.key}`;
        const value = values[field.key];
        const label = (
          <Label htmlFor={id}>
            {field.label}
            {field.required ? <span className="text-destructive"> *</span> : null}
          </Label>
        );
        const error = errors[field.key];

        return (
          <div
            key={field.key}
            className={field.type === "textarea" || field.type === "checkbox" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}
            data-edit-field={customEditFieldKey(field.key)}
          >
            {field.type !== "checkbox" ? label : null}

            {field.type === "textarea" ? (
              <Textarea
                id={id}
                rows={3}
                disabled={disabled}
                value={String(value ?? "")}
                onChange={(event) => onChange(field.key, event.target.value)}
                className={error ? "border-destructive" : ""}
              />
            ) : null}

            {field.type === "text" ? (
              <Input
                id={id}
                disabled={disabled}
                value={String(value ?? "")}
                onChange={(event) => onChange(field.key, event.target.value)}
                className={error ? "border-destructive" : ""}
              />
            ) : null}

            {field.type === "number" ? (
              <Input
                id={id}
                type="number"
                step="any"
                disabled={disabled}
                value={value == null ? "" : String(value)}
                onChange={(event) => onChange(field.key, event.target.value)}
                className={error ? "border-destructive" : ""}
              />
            ) : null}

            {field.type === "date" ? (
              <Input
                id={id}
                type="date"
                disabled={disabled}
                value={String(value ?? "")}
                onChange={(event) => onChange(field.key, event.target.value)}
                className={error ? "border-destructive" : ""}
              />
            ) : null}

            {field.type === "datetime" ? (
              <Input
                id={id}
                type="datetime-local"
                disabled={disabled}
                value={String(value ?? "")}
                onChange={(event) => onChange(field.key, event.target.value)}
                className={error ? "border-destructive" : ""}
              />
            ) : null}

            {field.type === "select" ? (
              <Select
                value={String(value ?? "")}
                onValueChange={(next) => onChange(field.key, next)}
                disabled={disabled}
              >
                <SelectTrigger id={id} className={error ? "border-destructive" : ""}>
                  <SelectValue placeholder={t("orders.form.selectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {field.type === "checkbox" ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  id={id}
                  disabled={disabled}
                  className="size-4"
                  checked={value === true || value === "true"}
                  onChange={(event) => onChange(field.key, event.target.checked)}
                />
                <span>
                  {field.label}
                  {field.required ? <span className="text-destructive"> *</span> : null}
                </span>
              </label>
            ) : null}

            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
