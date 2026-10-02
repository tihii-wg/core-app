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
  unit: "pcs",
  purchasePrice: null,
  sellingPrice: null,
  supplier: "",
  location: "",
  isActive: true,
};

export function AddInventoryItemDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { markupPercent, markupLoading, commitMarkup } = useInventoryMarkupEditor();
  const { mutate: createItem, isPending: isCreating } = useCreateInventoryItem();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Inventory Item</DialogTitle>
          <DialogDescription className="sr-only">Create an inventory item for the current workspace.</DialogDescription>
        </DialogHeader>
        {markupLoading ? (
          <p className="text-sm text-[#939699]">Loading item...</p>
        ) : (
          <InventoryItemForm
            defaultValues={emptyInventoryForm}
            markupPercent={markupPercent}
            submitLabel="Add Item"
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
