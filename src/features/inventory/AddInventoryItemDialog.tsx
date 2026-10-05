import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
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

export function AddInventoryItemDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { markupPercent, markupLoading, commitMarkup } = useInventoryMarkupEditor();
  const { mutate: createItem, isPending: isCreating } = useCreateInventoryItem();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("inventory.dialogs.addTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("inventory.dialogs.addDescription")}</DialogDescription>
        </DialogHeader>
        {markupLoading ? (
          <p className="text-sm text-muted-foreground">{t("inventory.dialogs.loadingItem")}</p>
        ) : (
          <InventoryItemForm
            defaultValues={{ ...emptyInventoryForm, unit: t("inventory.form.defaultUnit") }}
            markupPercent={markupPercent}
            submitLabel={t("inventory.addItem")}
            isSubmitting={isCreating}
            onCancel={() => onOpenChange(false)}
            onMarkupCommit={commitMarkup}
            onSubmit={(data) => {
              createItem(data, {
                onSuccess: () => onOpenChange(false),
              });
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
