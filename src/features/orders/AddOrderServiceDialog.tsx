import { useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { Order, OrderService } from "../../lib/types";
import useGetEmployees from "../employees/useGetEmployees";
import { industryUsesMileageWarranty } from "../industries/industryCapabilities";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import useGetServices from "../services/useGetServices";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageServices } from "../workspaces/workspaceRoles";
import AddOrderLinesDialogShell from "./AddOrderLinesDialogShell";
import OrderServiceLinesFields from "./OrderServiceLinesFields";
import { assignableTeamOptions } from "./assignableTechnicians";
import { usesWorksAndMaterialsTabLabel } from "./orderDetailTabs";
import { useAppendOrderLines } from "./useAppendOrderLines";
import { useWorkspaceWarrantyDefaults } from "./useWorkspaceWarrantyDefaults";

type AddOrderServiceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order;
  onAdded: (order: Order) => void;
};

type DraftServicesForm = { services: OrderService[] };

function AddOrderServiceDialogBody({ open, onOpenChange, order, onAdded }: AddOrderServiceDialogProps) {
  const { t } = useTranslation();
  const { workflow, industrySlug } = useIndustryWorkflow();
  const works = usesWorksAndMaterialsTabLabel(industrySlug);
  const { services } = useGetServices();
  const { employees } = useGetEmployees();
  const canCreateServices = canManageServices(useActiveWorkspaceRole());
  const warrantyDefaults = useWorkspaceWarrantyDefaults();
  const { mutateAsync: appendLines, isPending } = useAppendOrderLines();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [emptyError, setEmptyError] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<DraftServicesForm>({ defaultValues: { services: [] } });
  const { fields, append, remove } = useFieldArray({ control, name: "services" });

  const activeServices = useMemo(() => services?.filter((service) => service.status === "active"), [services]);
  const performerOptions = assignableTeamOptions(employees, order.assignedEmployeeId, [
    ...(order.team ?? []).map((member) => ({ id: member.employeeId, name: member.name })),
    ...order.services.map((line) => ({ id: line.technicianId, name: line.technicianName })),
  ]);

  const onSubmit = handleSubmit(async (data) => {
    setSaveError(null);
    const drafts = data.services ?? [];
    if (drafts.length === 0) {
      setEmptyError(true);
      return;
    }
    try {
      const updated = await appendLines({ orderId: order.id, kind: "services", drafts });
      onAdded(updated);
      onOpenChange(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("common.somethingWentWrong"));
    }
  });

  return (
    <AddOrderLinesDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t(works ? "orders.detail.tabs.addWork" : "orders.detail.tabs.addService")}
      description={t(works ? "orders.addLines.workHint" : "orders.addLines.serviceHint")}
      error={saveError ?? (emptyError ? t(works ? "orders.addLines.needWork" : "orders.addLines.needService") : null)}
      pending={isPending}
      onSubmit={() => void onSubmit()}
    >
      <OrderServiceLinesFields
        control={control as never}
        fields={fields}
        append={append}
        onRemove={remove}
        setValue={setValue}
        catalogServices={activeServices}
        allowCreate={canCreateServices}
        performerOptions={performerOptions}
        onLineAdded={() => setEmptyError(false)}
        warrantyDefaults={warrantyDefaults}
        orderMileageUnit={order.vehicleMileageUnitSnapshot ?? "km"}
        showWarrantyKm={industryUsesMileageWarranty(workflow)}
        disabled={isPending}
        idPrefix="add-service"
        label={t(works ? "orders.detail.tabs.addWork" : "orders.detail.tabs.addService")}
        errors={errors.services}
      />
    </AddOrderLinesDialogShell>
  );
}

/**
 * Add-only dialog for the order card's items tab. Composes new service lines with the shared
 * `OrderServiceLinesFields` (same UI as the create / edit forms) and appends them to the order's fresh lines
 * through `updateOrder` — see `appendOrderServiceLines`.
 */
export default function AddOrderServiceDialog(props: AddOrderServiceDialogProps) {
  // Mount the form only while open so every opening starts with an empty draft list and no stale error.
  if (!props.open) return null;
  return <AddOrderServiceDialogBody {...props} />;
}
