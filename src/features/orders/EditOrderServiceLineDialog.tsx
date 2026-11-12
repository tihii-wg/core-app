import { useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { Order, OrderService } from "../../lib/types";
import useGetEmployees from "../employees/useGetEmployees";
import { industryUsesMileageWarranty } from "../industries/industryCapabilities";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import AddOrderLinesDialogShell from "./AddOrderLinesDialogShell";
import OrderServiceLinesFields from "./OrderServiceLinesFields";
import { assignableTeamOptions } from "./assignableTechnicians";
import { usesWorksAndMaterialsTabLabel } from "./orderDetailTabs";
import {
  diffOrderServiceLinePatch,
  orderServiceLinePatchIsEmpty,
} from "./updateOrderServiceLine";
import { useUpdateOrderServiceLine } from "./useUpdateOrderServiceLine";
import { useWorkspaceWarrantyDefaults } from "./useWorkspaceWarrantyDefaults";

type EditOrderServiceLineDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order;
  line: OrderService;
  onSaved: (order: Order) => void;
};

type DraftServicesForm = { services: OrderService[] };

function lineToFormDefaults(line: OrderService): OrderService {
  return {
    id: line.id,
    serviceId: line.serviceId,
    serviceName: line.serviceName,
    price: line.price,
    quantity: line.quantity,
    kind: line.kind ?? null,
    technicianId: line.technicianId ?? null,
    technicianName: line.technicianName ?? "",
    warrantyMonths: line.warrantyMonths ?? null,
    warrantyDays: line.warrantyDays ?? null,
    warrantyKm: line.warrantyKm ?? null,
    discountType: line.discountType ?? null,
    discountValue: line.discountValue ?? null,
  };
}

function EditOrderServiceLineDialogBody({
  open,
  onOpenChange,
  order,
  line,
  onSaved,
}: EditOrderServiceLineDialogProps) {
  const { t } = useTranslation();
  const { workflow, industrySlug } = useIndustryWorkflow();
  const works = usesWorksAndMaterialsTabLabel(industrySlug);
  const { employees } = useGetEmployees();
  const warrantyDefaults = useWorkspaceWarrantyDefaults();
  const { mutateAsync: saveLine, isPending } = useUpdateOrderServiceLine();
  const [saveError, setSaveError] = useState<string | null>(null);

  const defaults = useMemo(() => lineToFormDefaults(line), [line]);

  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<DraftServicesForm>({
    defaultValues: { services: [defaults] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "services" });
  const watched = watch("services");

  const performerOptions = assignableTeamOptions(employees, order.assignedEmployeeId, [
    ...(order.team ?? []).map((member) => ({ id: member.employeeId, name: member.name })),
    ...order.services.map((entry) => ({ id: entry.technicianId, name: entry.technicianName })),
  ]);

  const draftLine = watched?.[0] ?? defaults;
  const pendingPatch = diffOrderServiceLinePatch(defaults, draftLine);
  const unchanged = orderServiceLinePatchIsEmpty(pendingPatch) && !isDirty;

  const onSubmit = handleSubmit(async (data) => {
    setSaveError(null);
    const draft = data.services?.[0];
    if (!draft || !line.id) return;
    const patch = diffOrderServiceLinePatch(defaults, draft);
    if (orderServiceLinePatchIsEmpty(patch)) {
      onOpenChange(false);
      return;
    }
    try {
      const updated = await saveLine({ orderId: order.id, lineId: line.id, patch });
      onSaved(updated);
      onOpenChange(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("common.somethingWentWrong"));
    }
  });

  return (
    <AddOrderLinesDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={line.serviceName}
      description={t(works ? "orders.lineEdit.workHint" : "orders.lineEdit.serviceHint")}
      error={saveError}
      pending={isPending}
      submitDisabled={unchanged}
      submitLabel={t("common.save")}
      submitTestId="edit-order-service-line-submit"
      onSubmit={() => void onSubmit()}
    >
      <OrderServiceLinesFields
        control={control as never}
        fields={fields}
        append={append}
        onRemove={remove}
        setValue={setValue}
        catalogServices={[]}
        allowCreate={false}
        performerOptions={performerOptions}
        warrantyDefaults={warrantyDefaults}
        orderMileageUnit={order.vehicleMileageUnitSnapshot ?? "km"}
        showWarrantyKm={industryUsesMileageWarranty(workflow)}
        disabled={isPending}
        idPrefix="edit-service-line"
        label={line.serviceName}
        errors={errors.services}
        singleLine
      />
    </AddOrderLinesDialogShell>
  );
}

/**
 * Edit one existing service line on the order card (price, qty, performer, kind, warranty).
 * Catalog service identity stays read-only; add/remove controls are hidden via `singleLine`.
 */
export default function EditOrderServiceLineDialog(props: EditOrderServiceLineDialogProps) {
  if (!props.open || !props.line.id) return null;
  return <EditOrderServiceLineDialogBody key={props.line.id} {...props} />;
}
