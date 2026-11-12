import { useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import type { InventoryItem, Order, OrderMaterial } from "../../lib/types";
import { industryUsesMileageWarranty } from "../industries/industryCapabilities";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
import AddOrderLinesDialogShell from "./AddOrderLinesDialogShell";
import OrderMaterialLinesEditor from "./OrderMaterialLinesEditor";
import { usesWorksAndMaterialsTabLabel } from "./orderDetailTabs";
import { useAppendOrderLines } from "./useAppendOrderLines";
import { useWorkspaceWarrantyDefaults } from "./useWorkspaceWarrantyDefaults";

export type AddOrderMaterialPrefill =
  | { kind: "catalog"; item: InventoryItem }
  | { kind: "one_time" | "customer"; name: string };

type AddOrderMaterialDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order;
  onAdded: (order: Order) => void;
  /**
   * Optional optimistic hook: called with the drafts right before the save starts; the dialog closes at once.
   * Returns a revert function used when the save fails (the error is then shown as a toast).
   */
  onPending?: (drafts: OrderMaterial[]) => () => void;
  /** Optional seed from the items-tab unified search. */
  prefill?: AddOrderMaterialPrefill | null;
};

type DraftMaterialsForm = { materials: OrderMaterial[] };

function AddOrderMaterialDialogBody({ open, onOpenChange, order, onAdded, onPending, prefill }: AddOrderMaterialDialogProps) {
  const { t } = useTranslation();
  const { workflow, industrySlug } = useIndustryWorkflow();
  const works = usesWorksAndMaterialsTabLabel(industrySlug);
  const { items: inventoryItems } = useGetInventoryItems("", "all", { field: "name", ascending: true });
  const warrantyDefaults = useWorkspaceWarrantyDefaults();
  const { mutateAsync: appendLines, isPending } = useAppendOrderLines();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [emptyError, setEmptyError] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    getValues,
    trigger,
    formState: { errors, isSubmitted, isValid },
  } = useForm<DraftMaterialsForm>({ defaultValues: { materials: [] }, mode: "onChange" });
  const { fields, append, remove } = useFieldArray({ control, name: "materials" });
  const activeInventory = useMemo(() => inventoryItems.filter((item) => item.isActive), [inventoryItems]);

  const onSubmit = handleSubmit(async (data) => {
    setSaveError(null);
    const drafts = data.materials ?? [];
    if (drafts.length === 0) {
      setEmptyError(true);
      return;
    }
    if (onPending) {
      // Stock limits were already enforced in the form, so show the lines immediately and save in the background.
      const revert = onPending(drafts);
      onOpenChange(false);
      try {
        onAdded(await appendLines({ orderId: order.id, kind: "materials", drafts }));
      } catch (error) {
        revert();
        toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
      }
      return;
    }
    try {
      const updated = await appendLines({ orderId: order.id, kind: "materials", drafts });
      onAdded(updated);
      onOpenChange(false);
    } catch (error) {
      // Closed order / insufficient stock / no warehouse: keep the dialog open with the reason.
      setSaveError(error instanceof Error ? error.message : t("common.somethingWentWrong"));
    }
  });

  return (
    <AddOrderLinesDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t(works ? "orders.detail.tabs.addMaterial" : "orders.detail.tabs.addProduct")}
      description={t("orders.addLines.materialHint")}
      error={saveError ?? (emptyError ? t("orders.addLines.needMaterial") : null)}
      pending={isPending}
      submitDisabled={fields.length > 0 && !isValid}
      onSubmit={() => void onSubmit()}
    >
      <OrderMaterialLinesEditor
        control={control as never}
        fields={fields}
        append={(value, options) => {
          setEmptyError(false);
          append(value as OrderMaterial | OrderMaterial[], options);
        }}
        remove={remove}
        setValue={setValue}
        getValues={getValues}
        trigger={trigger as never}
        inventoryItems={activeInventory}
        disabled={isPending}
        warrantyDefaults={warrantyDefaults}
        orderMileageUnit={order.vehicleMileageUnitSnapshot ?? "km"}
        showWarrantyKm={industryUsesMileageWarranty(workflow)}
        isSubmitted={isSubmitted}
        errors={errors.materials}
        initialAddMode={prefill?.kind === "one_time" || prefill?.kind === "customer" ? prefill.kind : "catalog"}
        initialFreeName={prefill?.kind === "one_time" || prefill?.kind === "customer" ? prefill.name : ""}
        initialCatalogItem={prefill?.kind === "catalog" ? prefill.item : null}
      />
    </AddOrderLinesDialogShell>
  );
}

/**
 * Add-only dialog for the order card's items tab. Wraps the same `OrderMaterialLinesEditor` the create / edit
 * forms use, bound to a draft-only field array (so only the add controls and the new lines are shown), and
 * appends the drafts to the order's fresh materials through `updateOrder` — see `appendOrderMaterialLines`.
 */
export default function AddOrderMaterialDialog(props: AddOrderMaterialDialogProps) {
  // Mount the form only while open so every opening starts with an empty draft list and no stale error.
  if (!props.open) return null;
  return <AddOrderMaterialDialogBody {...props} />;
}
