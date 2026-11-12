import { memo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "lucide-react";
import type { Order } from "../../../../lib/types";
import { StatusBadge } from "../../../../ui/StatusBadge";
import type { useIndustryWorkflow } from "../../../industries/useIndustryWorkflow";
import { OrderInlineField } from "../../OrderInlineField";
import { displayCustomFieldValue } from "../../../../services/apiCustomFields";
import type { OrderFieldConfigItem } from "../../orderFieldConfig";
import type { OrderEditField } from "../../orderEditFields";

export type OrderInfoFieldsProps = {
  order: Order;
  copy: ReturnType<typeof useIndustryWorkflow>["copy"];
  showClientVehicles: boolean;
  showFieldEdit: boolean;
  deadline: string;
  overdue: boolean;
  editingField: OrderEditField | null;
  orderFieldMap: Map<string, OrderFieldConfigItem>;
  orderFieldConfig: OrderFieldConfigItem[];
  customFieldValues: { definitionId: string; value: unknown }[];
  fieldLabel: (key: string, fallback: string) => string;
  fieldVisible: (key: string, industryDefault?: boolean) => boolean;
  showAssetField: (name: "device" | "carNumber" | "vin") => boolean;
  industryBlocks: Record<string, boolean>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inlineCommon: (field: OrderEditField) => any;
  renderTextField: (
    field: OrderEditField,
    label: string,
    current: string | null | undefined,
    options?: { kind?: "text" | "textarea"; mono?: boolean; masked?: boolean },
  ) => ReactNode;
  renderDateTimeField: (
    field: "measurementAt" | "installationAt",
    label: string,
    iso: string | null | undefined,
  ) => ReactNode;
  customInlineKind: (type: string) => "text" | "textarea" | "number" | "date" | "select" | "checkbox" | "datetime-local";
  customEditFieldKey: (key: string) => OrderEditField;
};

function OrderInfoFieldsComponent({
  order,
  copy,
  showClientVehicles,
  showFieldEdit,
  deadline,
  overdue,
  editingField,
  orderFieldConfig,
  customFieldValues,
  fieldLabel,
  fieldVisible,
  showAssetField,
  industryBlocks,
  inlineCommon,
  renderTextField,
  renderDateTimeField,
  customInlineKind,
  customEditFieldKey,
}: OrderInfoFieldsProps) {
  const { t } = useTranslation();

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
      {deadline || (showFieldEdit && fieldVisible("deadline")) ? (
        <OrderInlineField
          label={fieldLabel("deadline", copy.deadlineDetail)}
          value={
            deadline ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 ${overdue ? "text-destructive" : ""}`}>
                  <Calendar className={`size-3.5 ${overdue ? "text-destructive" : "text-subtle-foreground"}`} />
                  {deadline}
                </span>
                {overdue ? <StatusBadge variant="danger">{t("orders.detail.overdue")}</StatusBadge> : null}
              </span>
            ) : (
              ""
            )
          }
          editValue={deadline.slice(0, 10)}
          kind="date"
          {...inlineCommon("deadline")}
        />
      ) : null}

      {!showClientVehicles && showAssetField("device")
        ? renderTextField("device", fieldLabel("device", copy.deviceDetail), order.device)
        : null}
      {!showClientVehicles && showAssetField("carNumber")
        ? renderTextField("carNumber", fieldLabel("carNumber", copy.carNumberDetail), order.carNumber)
        : null}
      {!showClientVehicles && showAssetField("vin")
        ? renderTextField("vin", fieldLabel("vin", copy.vinDetail), order.vin, { mono: true })
        : null}
      {fieldVisible("deviceSerial", industryBlocks.deviceSerial)
        ? renderTextField(
            "deviceSerial",
            fieldLabel("deviceSerial", t("orders.industryFields.deviceSerial")),
            order.deviceSerial,
            { mono: true },
          )
        : null}
      {fieldVisible("deviceImei", industryBlocks.deviceImei)
        ? renderTextField(
            "deviceImei",
            fieldLabel("deviceImei", t("orders.industryFields.deviceImei")),
            order.deviceImei,
            { mono: true },
          )
        : null}
      {fieldVisible("deviceCondition", industryBlocks.deviceCondition)
        ? renderTextField(
            "deviceCondition",
            fieldLabel("deviceCondition", t("orders.industryFields.deviceCondition")),
            order.deviceCondition,
            { kind: "textarea" },
          )
        : null}
      {fieldVisible("deviceCompleteness", industryBlocks.deviceCompleteness)
        ? renderTextField(
            "deviceCompleteness",
            fieldLabel("deviceCompleteness", t("orders.industryFields.deviceCompleteness")),
            order.deviceCompleteness,
            { kind: "textarea" },
          )
        : null}
      {fieldVisible("devicePasscode", industryBlocks.devicePasscode)
        ? renderTextField(
            "devicePasscode",
            fieldLabel("devicePasscode", t("orders.industryFields.devicePasscode")),
            order.devicePasscode,
            { mono: true, masked: true },
          )
        : null}
      {fieldVisible("siteAddress", industryBlocks.siteAddress)
        ? renderTextField(
            "siteAddress",
            fieldLabel("siteAddress", t("orders.industryFields.siteAddress")),
            order.siteAddress,
          )
        : null}
      {fieldVisible("productDimensions", industryBlocks.productDimensions)
        ? renderTextField(
            "productDimensions",
            fieldLabel("productDimensions", t("orders.industryFields.productDimensions")),
            order.productDimensions,
          )
        : null}
      {fieldVisible("measurementAt", industryBlocks.measurementAt)
        ? renderDateTimeField(
            "measurementAt",
            fieldLabel("measurementAt", t("orders.industryFields.measurementAt")),
            order.measurementAt,
          )
        : null}
      {fieldVisible("installationAt", industryBlocks.installationAt)
        ? renderDateTimeField(
            "installationAt",
            fieldLabel("installationAt", t("orders.industryFields.installationAt")),
            order.installationAt,
          )
        : null}
      {orderFieldConfig
        .filter((field) => field.isCustom && field.visible)
        .map((field) => {
          const row = customFieldValues.find((value) => value.definitionId === field.definitionId);
          const text = displayCustomFieldValue(field.type ?? "text", row?.value, field.options);
          const editKey = customEditFieldKey(field.key as string);
          const kind = customInlineKind(field.type);
          const checked = row?.value === true || row?.value === "true";
          return (
            <OrderInlineField
              key={field.key}
              label={field.label}
              value={field.type === "checkbox" ? (checked ? "✓" : "—") : text}
              editValue={field.type === "checkbox" ? checked : row?.value == null ? "" : String(row.value)}
              kind={kind}
              options={field.options}
              className={field.type === "textarea" && editingField === editKey ? "col-span-2" : undefined}
              {...inlineCommon(editKey)}
            />
          );
        })}
    </dl>
  );
}

export const OrderInfoFields = memo(OrderInfoFieldsComponent);
