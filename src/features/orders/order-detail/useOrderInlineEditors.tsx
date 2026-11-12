import { useCallback, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { serializeCustomFieldValue } from "../../../services/apiCustomFields";
import type { UpdateOrderFieldsPatch } from "../../../services/apiOrders";
import type { Order, Vehicle } from "../../../lib/types";
import type { OrderEditField } from "../orderEditFields";
import { parseCustomEditField } from "../orderFieldRegistry";
import {
  OrderInlineField,
  type OrderInlineFieldHandle,
  type OrderInlineFieldValue,
} from "../OrderInlineField";
import { useUpdateOrderCustomFieldValue, useUpdateOrderFields } from "../useUpdateOrderFields";
import { combineDateTimeLocal, isInstallationBeforeMeasurement, splitDateTimeLocal } from "../industryOrderFieldHelpers";
import { buildOrderMileageSnapshot, parseVisitMileage, persistOrderVehicleMileage } from "../orderVehicleMileage";
import type { OrderFieldConfigItem } from "../orderFieldConfig";
import { useGuardSubscriptionWrite } from "../../workspaces/useWorkspaceSubscription";
import { useUnsavedChangesConfirm } from "../../../ui/ConfirmProvider";
import { formatIndustryDateTime } from "./detailHelpers";

export type UseOrderInlineEditorsArgs = {
  selectedOrder: Order | null;
  showFieldEdit: boolean;
  orderFieldMap: Map<string, OrderFieldConfigItem>;
  orderFieldConfig: OrderFieldConfigItem[];
  linkedVehicle: Vehicle | null;
  workspaceId: string | undefined;
  onOrderUpdated: (order: Order) => void;
  editingField: OrderEditField | null;
  setEditingField: (field: OrderEditField | null) => void;
  inlineDirty: boolean;
  setInlineDirty: (dirty: boolean) => void;
};

export function useOrderInlineEditors({
  selectedOrder,
  showFieldEdit,
  orderFieldMap,
  orderFieldConfig,
  linkedVehicle,
  workspaceId,
  onOrderUpdated,
  editingField,
  setEditingField,
  inlineDirty,
  setInlineDirty,
}: UseOrderInlineEditorsArgs) {
  const { t, i18n } = useTranslation();
  const confirmDiscardChanges = useUnsavedChangesConfirm();
  const queryClient = useQueryClient();
  const guardWrite = useGuardSubscriptionWrite();
  const inlineFieldRef = useRef<OrderInlineFieldHandle | null>(null);
  const setInlineFieldHandle = useCallback((handle: OrderInlineFieldHandle | null) => {
    inlineFieldRef.current = handle;
  }, []);
  const { mutateAsync: saveOrderFields, isPending: isFieldSaving } = useUpdateOrderFields();
  const { mutateAsync: saveCustomFieldValue, isPending: isCustomFieldSaving } = useUpdateOrderCustomFieldValue();
  const inlineSaving = isFieldSaving || isCustomFieldSaving;

  function closeInlineEditor() {
    setInlineDirty(false);
    setEditingField(null);
  }

  async function settleInlineEdit(): Promise<boolean> {
    if (!editingField) return true;
    if (inlineDirty && !(await confirmDiscardChanges())) return false;
    closeInlineEditor();
    return true;
  }

  async function requestInlineEdit(field: OrderEditField) {
    if (editingField === field || inlineSaving) return;
    if (editingField && !(await settleInlineEdit())) return;
    setEditingField(field);
  }

  async function saveInlineField(field: OrderEditField, raw: OrderInlineFieldValue) {
    if (!selectedOrder) return;
    const order = selectedOrder;
    const text = typeof raw === "string" ? raw : "";

    const customKey = parseCustomEditField(field);
    if (customKey) {
      const definition = orderFieldConfig.find((item) => item.isCustom && item.key === customKey);
      if (!definition?.definitionId) throw new Error(t("common.somethingWentWrong"));
      await saveCustomFieldValue({
        orderId: order.id,
        definitionId: definition.definitionId,
        value: serializeCustomFieldValue(definition.type, raw),
      });
      closeInlineEditor();
      return;
    }

    let patch: UpdateOrderFieldsPatch;
    switch (field) {
      case "measurementAt":
      case "installationAt": {
        const [date = "", time = ""] = text.split("T");
        const iso = combineDateTimeLocal(date, time);
        if (text.trim() && !iso) throw new Error(t("common.somethingWentWrong"));
        const invalidOrder =
          field === "installationAt"
            ? isInstallationBeforeMeasurement(order.measurementAt ?? null, iso)
            : isInstallationBeforeMeasurement(iso, order.installationAt ?? null);
        if (invalidOrder) throw new Error(t("orders.validation.installationBeforeMeasurement"));
        patch = { [field]: iso };
        break;
      }
      case "vehicleCurrentMileage": {
        const reading = parseVisitMileage(text);
        if (reading == null) {
          closeInlineEditor();
          return;
        }
        if (!linkedVehicle) throw new Error(t("vehicles.errors.notFound"));
        guardWrite();
        await persistOrderVehicleMileage({
          workspaceId,
          clientId: linkedVehicle.clientId,
          vehicle: linkedVehicle,
          formMileage: text,
          queryClient,
        });
        patch = buildOrderMileageSnapshot(text, linkedVehicle) ?? {};
        if (Object.keys(patch).length === 0) {
          closeInlineEditor();
          return;
        }
        break;
      }
      case "description":
      case "deadline":
      case "device":
      case "carNumber":
      case "vin":
      case "deviceSerial":
      case "deviceImei":
      case "deviceCondition":
      case "deviceCompleteness":
      case "devicePasscode":
      case "siteAddress":
      case "productDimensions":
        patch = { [field]: text } as UpdateOrderFieldsPatch;
        break;
      default:
        throw new Error(t("common.somethingWentWrong"));
    }

    const updated = await saveOrderFields({ orderId: order.id, patch });
    onOrderUpdated(updated);
    closeInlineEditor();
  }

  const inlineCommon = (field: OrderEditField) => {
    const customKey = parseCustomEditField(field);
    const configKey = customKey ?? field;
    return {
      fieldKey: field,
      editable: showFieldEdit,
      isEditing: editingField === field,
      // eslint-disable-next-line react-hooks/refs
      ref: editingField === field ? setInlineFieldHandle : undefined,
      required: orderFieldMap.get(configKey)?.required ?? false,
      saving: inlineSaving && editingField === field,
      onRequestEdit: () => void requestInlineEdit(field),
      onCancel: closeInlineEditor,
      onDirtyChange: setInlineDirty,
      onSave: (next: OrderInlineFieldValue) => saveInlineField(field, next),
    };
  };

  function renderTextField(
    field: OrderEditField,
    label: string,
    current: string | null | undefined,
    options: { kind?: "text" | "textarea"; mono?: boolean; masked?: boolean } = {},
  ): ReactNode {
    const kind = options.kind ?? "text";
    return (
      <OrderInlineField
        key={field}
        label={label}
        value={current?.trim() ? current : ""}
        editValue={current ?? ""}
        kind={kind}
        mono={options.mono}
        masked={options.masked}
        className={kind === "textarea" && editingField === field ? "col-span-2" : undefined}
        {...inlineCommon(field)}
      />
    );
  }

  function renderDateTimeField(
    field: "measurementAt" | "installationAt",
    label: string,
    iso: string | null | undefined,
  ): ReactNode {
    const parts = splitDateTimeLocal(iso);
    return (
      <OrderInlineField
        key={field}
        label={label}
        value={iso ? formatIndustryDateTime(iso, i18n.language) : ""}
        editValue={parts.date ? `${parts.date}T${parts.time || "00:00"}` : ""}
        kind="datetime-local"
        {...inlineCommon(field)}
      />
    );
  }

  return {
    inlineFieldRef,
    inlineSaving,
    closeInlineEditor,
    settleInlineEdit,
    requestInlineEdit,
    inlineCommon,
    renderTextField,
    renderDateTimeField,
  };
}
