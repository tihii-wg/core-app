import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import type { InventoryItem } from "../../lib/types";
import { industryInventoryCopy } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import InventoryItemForm from "./InventoryItemForm";
import { useCreateInventoryItem } from "./useCreateInventoryItem";
import { useInventoryMarkupEditor } from "./useInventoryMarkupEditor";

const emptyInventoryForm = {
  name: "",
  sku: "",
  description: "",
  category: "",
  quantity: 0,
  minQuantity: 0,
  purchasePrice: null,
  sellingPrice: null,
  supplier: "",
  location: "",
  isActive: true,
};

type AddInventoryItemDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefills the name field (e.g. from order material search). */
  initialName?: string;
  /** Called with the created item after a successful save (form stays open on error). */
  onCreated?: (item: InventoryItem) => void;
};

export function AddInventoryItemDialog({ open, onOpenChange, initialName = "", onCreated }: AddInventoryItemDialogProps) {
  const { t } = useTranslation();
  const { workflow } = useIndustryWorkflow();
  const inventoryCopy = industryInventoryCopy(workflow);
  const { markupPercent, markupLoading, commitMarkup } = useInventoryMarkupEditor();
  const { mutate: createItem, isPending: isCreating } = useCreateInventoryItem();
  const formKey = open ? `create-${initialName}` : "closed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{inventoryCopy.addDialogTitle}</DialogTitle>
          <DialogDescription className="sr-only">{inventoryCopy.addDialogDescription}</DialogDescription>
        </DialogHeader>
        {markupLoading ? (
          <p className="text-sm text-muted-foreground">{t("inventory.dialogs.loadingItem")}</p>
        ) : (
          <InventoryItemForm
            key={formKey}
            defaultValues={{
              ...emptyInventoryForm,
              name: initialName,
              unit: t("inventory.form.defaultUnit"),
            }}
            markupPercent={markupPercent}
            submitLabel={inventoryCopy.addItem}
            isSubmitting={isCreating}
            onCancel={() => onOpenChange(false)}
            onMarkupCommit={commitMarkup}
            onSubmit={(data) => {
              createItem(data, {
                onSuccess: (item) => {
                  onCreated?.(item);
                  onOpenChange(false);
                },
              });
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
