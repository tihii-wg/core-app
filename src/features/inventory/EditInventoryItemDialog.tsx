import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { EmptyState } from "../../ui/EmptyState";
import InventoryItemForm from "./InventoryItemForm";
import { useGetInventoryItem } from "./useGetInventoryItem";
import { useInventoryMarkupEditor } from "./useInventoryMarkupEditor";
import { useUpdateInventoryItem } from "./useUpdateInventoryItem";

export function EditInventoryItemDialog({ itemId, onClose }: { itemId: string | null; onClose: () => void }) {
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
          <DialogTitle>Edit Inventory Item</DialogTitle>
          <DialogDescription className="sr-only">Update the selected inventory item.</DialogDescription>
        </DialogHeader>
        {editQuery.isLoading && <p className="text-sm text-[#939699]">Loading item...</p>}
        {editQuery.isError && (
          <EmptyState title="Could not load inventory" description="Refresh the item to try again." action={{ label: "Try again", onClick: () => editQuery.refetch() }} />
        )}
        {editDefaults && editQuery.item && !markupLoading && (
          <InventoryItemForm
            key={editQuery.item.id}
            defaultValues={editDefaults}
            markupPercent={markupPercent}
            submitLabel="Save Changes"
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
