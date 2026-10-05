import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { EmptyState } from "../../ui/EmptyState";
import InventoryItemForm from "./InventoryItemForm";
import { useGetInventoryItem } from "./useGetInventoryItem";
import { useInventoryMarkupEditor } from "./useInventoryMarkupEditor";
import { useUpdateInventoryItem } from "./useUpdateInventoryItem";

export function EditInventoryItemDialog({ itemId, onClose }: { itemId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const editQuery = useGetInventoryItem(itemId);
  const { markupPercent, markupLoading, commitMarkup } = useInventoryMarkupEditor();
  const { mutate: updateItem, isPending: isUpdating } = useUpdateInventoryItem();

  const editDefaults = editQuery.item
    ? {
        name: editQuery.item.name,
        sku: editQuery.item.sku,
        description: editQuery.item.description,
        category: editQuery.item.category,
        quantity: editQuery.item.quantity,
        minQuantity: editQuery.item.minQuantity,
        unit: editQuery.item.unit,
        purchasePrice: editQuery.item.purchasePrice,
        sellingPrice: editQuery.item.sellingPrice,
        supplier: editQuery.item.supplier,
        location: editQuery.item.location,
        isActive: editQuery.item.isActive,
      }
    : null;

  return (
    <Dialog
      open={Boolean(itemId)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("inventory.dialogs.editTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("inventory.dialogs.editDescription")}</DialogDescription>
        </DialogHeader>
        {editQuery.isLoading && <p className="text-sm text-muted-foreground">{t("inventory.dialogs.loadingItem")}</p>}
        {editQuery.isError && (
          <EmptyState
            title={t("inventory.loadError.title")}
            description={t("inventory.loadError.itemDescription")}
            action={{ label: t("common.retry"), onClick: () => editQuery.refetch() }}
          />
        )}
        {editDefaults && editQuery.item && !markupLoading && (
          <InventoryItemForm
            key={editQuery.item.id}
            defaultValues={editDefaults}
            markupPercent={markupPercent}
            submitLabel={t("common.saveChanges")}
            isSubmitting={isUpdating}
            onCancel={onClose}
            onMarkupCommit={commitMarkup}
            onSubmit={(data) => {
              if (!editQuery.item) return;
              updateItem(
                { id: editQuery.item.id, ...data },
                {
                  onSuccess: onClose,
                },
              );
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
