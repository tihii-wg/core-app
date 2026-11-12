import { useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { Order, OrderMaterial } from "../../lib/types";
import { industryUsesMileageWarranty } from "../industries/industryCapabilities";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
import AddOrderLinesDialogShell from "./AddOrderLinesDialogShell";
import OrderMaterialLinesEditor from "./OrderMaterialLinesEditor";
import { usesWorksAndMaterialsTabLabel } from "./orderDetailTabs";
import {
  diffOrderMaterialLinePatch,
  orderMaterialLinePatchIsEmpty,
} from "./updateOrderMaterialLine";
import { useUpdateOrderMaterialLine } from "./useUpdateOrderMaterialLine";
import { useWorkspaceWarrantyDefaults } from "./useWorkspaceWarrantyDefaults";

type EditOrderMaterialLineDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order;
  line: OrderMaterial;
  onSaved: (order: Order) => void;
};

type DraftMaterialsForm = { materials: OrderMaterial[] };

function lineToFormDefaults(line: OrderMaterial): OrderMaterial {
  return {
    id: line.id,
    inventoryItemId: line.inventoryItemId,
    itemName: line.itemName,
    price: line.price,
    quantity: line.quantity,
    quantityIssued: line.quantityIssued,
    quantityReturned: line.quantityReturned,
    warehouseId: line.warehouseId,
    supplySource: line.supplySource,
    discountType: line.discountType ?? null,
    discountValue: line.discountValue ?? null,
    warrantyMonths: line.warrantyMonths ?? null,
    warrantyDays: line.warrantyDays ?? null,
    warrantyKm: line.warrantyKm ?? null,
  };
}

function EditOrderMaterialLineDialogBody({
  open,
  onOpenChange,
  order,
  line,
  onSaved,
}: EditOrderMaterialLineDialogProps) {
  const { t } = useTranslation();
  const { workflow, industrySlug } = useIndustryWorkflow();
  const works = usesWorksAndMaterialsTabLabel(industrySlug);
  const { items: inventoryItems } = useGetInventoryItems("", "all", { field: "name", ascending: true });
  const warrantyDefaults = useWorkspaceWarrantyDefaults();
  const { mutateAsync: saveLine, isPending } = useUpdateOrderMaterialLine();
  const [saveError, setSaveError] = useState<string | null>(null);

  const defaults = useMemo(() => lineToFormDefaults(line), [line]);
  const activeInventory = useMemo(() => inventoryItems.filter((item) => item.isActive), [inventoryItems]);

  const {
    control,
    handleSubmit,
    setValue,
    getValues,
    trigger,
    watch,
    formState: { errors, isDirty, isValid },
  } = useForm<DraftMaterialsForm>({
    defaultValues: { materials: [defaults] },
    mode: "onChange",
  });
  const { fields, append, remove } = useFieldArray({ control, name: "materials" });
  const watched = watch("materials");

  const draftLine = watched?.[0] ?? defaults;
  const pendingPatch = diffOrderMaterialLinePatch(defaults, draftLine);
  const unchanged = orderMaterialLinePatchIsEmpty(pendingPatch) && !isDirty;

  const onSubmit = handleSubmit(async (data) => {
    setSaveError(null);
    const draft = data.materials?.[0];
    if (!draft || !line.id) return;
    const patch = diffOrderMaterialLinePatch(defaults, draft);
    if (orderMaterialLinePatchIsEmpty(patch)) {
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
      title={line.itemName}
      description={t(works ? "orders.lineEdit.materialHintWorks" : "orders.lineEdit.materialHint")}
      error={saveError}
      pending={isPending}
      submitDisabled={unchanged || !isValid}
      submitLabel={t("common.save")}
      submitTestId="edit-order-material-line-submit"
      onSubmit={() => void onSubmit()}
    >
      <OrderMaterialLinesEditor
        control={control as never}
        fields={fields}
        append={append}
        remove={remove}
        setValue={setValue}
        getValues={getValues}
        trigger={trigger as never}
        inventoryItems={activeInventory}
        disabled={isPending}
        warrantyDefaults={warrantyDefaults}
        orderMileageUnit={order.vehicleMileageUnitSnapshot ?? "km"}
        showWarrantyKm={industryUsesMileageWarranty(workflow)}
        errors={errors.materials}
        singleLine
      />
    </AddOrderLinesDialogShell>
  );
}

/**
 * Edit one existing material line on the order card (qty, price, warehouse, warranty).
 * Item identity and supply source stay read-only; add/remove controls are hidden via `singleLine`.
 */
export default function EditOrderMaterialLineDialog(props: EditOrderMaterialLineDialogProps) {
  if (!props.open || !props.line.id) return null;
  return <EditOrderMaterialLineDialogBody key={props.line.id} {...props} />;
}
