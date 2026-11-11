import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Control, UseFieldArrayAppend, UseFormSetValue } from "react-hook-form";
import { Controller, useWatch } from "react-hook-form";
import type { MileageUnit, OrderService, Service } from "../../lib/types";
import { parseQuantity } from "../../lib/quantity";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import ServiceCombobox from "../services/ServiceCombobox";
import { catalogServiceToOrderLine, newServiceToOrderLine } from "../services/orderServiceLine";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import type { AssignableTechnician } from "./assignableTechnicians";
import OrderLinePerformerSelect from "./OrderLinePerformerSelect";
import OrderLinePriceField from "./OrderLinePriceField";
import OrderLineWarrantyFields from "./OrderLineWarrantyFields";
import OrderServiceKindSelect from "./OrderServiceKindSelect";
import type { WorkspaceWarrantyDefaults } from "./warranty";

type ServiceFieldRow = { serviceId: string; serviceName: string; fieldKey?: string; id?: string };

type OrderServiceLinesFieldsProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<any>;
  /** `useFieldArray({ name: "services" }).fields` — the saved / draft lines rendered below the combobox. */
  fields: ServiceFieldRow[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  append: UseFieldArrayAppend<any, "services">;
  /** Called with the row index when the user presses «Remove» (callers may confirm first). */
  onRemove: (index: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: UseFormSetValue<any>;
  /** Active catalog services offered by the combobox. */
  catalogServices: Service[] | undefined;
  allowCreate: boolean;
  /** Line performer choices. */
  performerOptions: AssignableTechnician[];
  /** Fired after a line performer is picked / defaulted so the caller can mirror it into the order team. */
  onPerformerChosen?: (employeeId: string | null | undefined) => void;
  /** Fired after a line was appended (e.g. to clear a form-level services error). */
  onLineAdded?: () => void;
  warrantyDefaults: WorkspaceWarrantyDefaults;
  orderMileageUnit?: MileageUnit;
  showWarrantyKm?: boolean;
  /** Disables every control (submitting). */
  disabled?: boolean;
  /** Disables only price + warranty (closed order content). Defaults to `disabled`. */
  warrantyDisabled?: boolean;
  /** DOM id prefix, e.g. `create-service`, `edit-service`, `add-service`. */
  idPrefix: string;
  label: ReactNode;
  /** `errors.services` from the host form. */
  errors?: {
    root?: { message?: string };
    [index: number]:
      | { price?: { message?: string }; quantity?: { message?: string } }
      | undefined;
  };
  /** Warranty-restart hint per row (edit form: a line replaced a deleted warranty-covered line). */
  restartHintForLine?: (line: OrderService) => boolean;
  /** Hide the line kind select (it is also hidden by itself until `order_services.kind` exists). */
  showKind?: boolean;
};

function quantityMessage(value: unknown, t: TFunction): true | string {
  const parsed = parseQuantity(value);
  if (parsed === "required") return t("orders.validation.quantityRequired") as string;
  if (parsed === "min") return t("orders.validation.quantityMin") as string;
  if (parsed === "maxDecimals") return t("orders.validation.quantityMaxDecimals") as string;
  return true;
}

function priceMessage(value: unknown, t: TFunction): true | string {
  const number = typeof value === "number" ? value : Number(value);
  if (value === "" || !Number.isFinite(number) || number < 0) return t("orders.form.freeformPriceInvalid") as string;
  return true;
}

/**
 * The «services» block shared by AddNewOrderForm, EditOrderForm and AddOrderServiceDialog:
 * catalog combobox (+ create-new flow) and, per line, quantity, price, kind, performer and warranty.
 * The host owns the react-hook-form field array (`services`), so each host decides how lines are saved.
 */
export default function OrderServiceLinesFields({
  control,
  fields,
  append,
  onRemove,
  setValue,
  catalogServices,
  allowCreate,
  performerOptions,
  onPerformerChosen,
  onLineAdded,
  warrantyDefaults,
  orderMileageUnit = "km",
  showWarrantyKm = true,
  disabled = false,
  warrantyDisabled,
  idPrefix,
  label,
  errors,
  restartHintForLine,
  showKind = true,
}: OrderServiceLinesFieldsProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const watched = useWatch({ control, name: "services" }) as OrderService[] | undefined;
  const lineLocked = warrantyDisabled ?? disabled;

  function hasService(serviceId: string | null, serviceName: string) {
    return fields.some(
      (field) =>
        (serviceId !== null && field.serviceId === serviceId) ||
        field.serviceName.toLowerCase() === serviceName.toLowerCase(),
    );
  }

  return (
    <div className="space-y-1.5" data-edit-field="services">
      <Label htmlFor="service">{label}</Label>
      <ServiceCombobox
        services={catalogServices ?? []}
        allowCreate={allowCreate}
        errors={!!errors?.root}
        onSelect={(service) => {
          if (hasService(service.id, service.service_name)) return;
          const line = catalogServiceToOrderLine(service, warrantyDefaults, orderMileageUnit);
          append(line);
          onPerformerChosen?.(line.technicianId);
          onLineAdded?.();
        }}
        onCreate={(serviceName, price) => {
          if (hasService(null, serviceName)) return;
          append(newServiceToOrderLine(serviceName, price, warrantyDefaults, orderMileageUnit));
          onLineAdded?.();
        }}
      />
      {errors?.root?.message && <p className="text-xs text-destructive">{errors.root.message}</p>}
      {fields.length > 0 && (
        <div className="space-y-2">
          {fields.map((field, index) => {
            const line = watched?.[index];
            const name = line?.serviceName ?? field.serviceName;
            const quantityError = errors?.[index]?.quantity?.message;
            const showRestartHint = Boolean(restartHintForLine?.(line ?? (field as unknown as OrderService)));
            return (
              <div key={field.fieldKey ?? field.id ?? index} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium [overflow-wrap:anywhere]">{field.serviceName}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {showKind ? (
                      <OrderServiceKindSelect
                        value={line?.kind}
                        lineName={name}
                        disabled={disabled}
                        onChange={(kind) => setValue(`services.${index}.kind`, kind, { shouldDirty: true })}
                      />
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onRemove(index)}
                      disabled={disabled}
                      aria-label={t("orders.form.removeService", { name })}
                    >
                      {t("orders.form.remove")}
                    </Button>
                  </div>
                </div>
                {showRestartHint ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400" data-warranty-restart-hint>
                    {t("orders.warranty.newWarrantyFromCloseHint")}
                  </p>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor={`${idPrefix}-qty-${index}`} className="text-xs">
                    {t("orders.form.quantityLabel")}
                  </Label>
                  <Controller
                    name={`services.${index}.quantity`}
                    control={control}
                    rules={{ validate: (value) => quantityMessage(value, t) }}
                    render={({ field: quantityField }) => (
                      <Input
                        id={`${idPrefix}-qty-${index}`}
                        type="text"
                        inputMode="decimal"
                        disabled={lineLocked}
                        aria-label={t("orders.form.quantityForService", { name })}
                        className={`h-8 w-24 text-center tabular-nums ${quantityError ? "border-destructive" : ""}`}
                        value={quantityField.value === "" || quantityField.value == null ? "" : quantityField.value}
                        onChange={(event) => {
                          const raw = event.target.value;
                          if (raw === "") {
                            quantityField.onChange("");
                            return;
                          }
                          const parsed = parseQuantity(raw);
                          quantityField.onChange(typeof parsed === "number" ? parsed : raw);
                        }}
                        onBlur={quantityField.onBlur}
                      />
                    )}
                  />
                  {quantityError ? <p className="text-xs text-destructive">{quantityError}</p> : null}
                </div>
                <Controller
                  name={`services.${index}.price`}
                  control={control}
                  rules={{ validate: (value) => priceMessage(value, t) }}
                  render={({ field: priceField }) => (
                    <OrderLinePriceField
                      id={`${idPrefix}-price-${index}`}
                      value={priceField.value as number | "" | null | undefined}
                      catalogPrice={catalogServices?.find((service) => service.id === field.serviceId)?.service_price ?? null}
                      disabled={lineLocked}
                      errorMessage={errors?.[index]?.price?.message}
                      formatMoney={formatMoney}
                      onChange={priceField.onChange}
                    />
                  )}
                />
                <OrderLinePerformerSelect
                  id={`${idPrefix}-performer-${index}`}
                  value={line?.technicianId ?? ""}
                  options={performerOptions}
                  disabled={disabled}
                  onChange={(technicianId) => {
                    setValue(`services.${index}.technicianId`, technicianId || null, { shouldDirty: true });
                    onPerformerChosen?.(technicianId);
                  }}
                />
                <OrderLineWarrantyFields
                  idPrefix={`${idPrefix}-${index}`}
                  months={line?.warrantyMonths}
                  days={line?.warrantyDays}
                  km={line?.warrantyKm}
                  mileageUnit={orderMileageUnit}
                  showWarrantyKm={showWarrantyKm}
                  disabled={lineLocked}
                  onChange={({ warrantyMonths, warrantyDays, warrantyKm }) => {
                    setValue(`services.${index}.warrantyMonths`, warrantyMonths, { shouldDirty: true });
                    setValue(`services.${index}.warrantyDays`, warrantyDays, { shouldDirty: true });
                    setValue(`services.${index}.warrantyKm`, warrantyKm, { shouldDirty: true });
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
