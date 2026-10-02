import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import type { InventoryItem } from "../../lib/types";
import { useDeleteInventoryItem } from "./useDeleteInventoryItem";

type DeleteInventoryItemDialogProps = {
  item: InventoryItem | null;
  onClose: () => void;
  onDeleted?: (itemId: string) => void;
};

export function DeleteInventoryItemDialog({ item, onClose, onDeleted }: DeleteInventoryItemDialogProps) {
  const { mutate: deleteItem, isPending: isDeleting } = useDeleteInventoryItem();

  return (
    <Dialog
      open={Boolean(item)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete inventory item?</DialogTitle>
          <DialogDescription>This action cannot be undone.</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Delete <strong className="text-foreground">{item?.name}</strong>?
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isDeleting}
            onClick={() => {
              if (!item) return;
              deleteItem(item.id, {
                onSuccess: () => {
                  onDeleted?.(item.id);
                  onClose();
                },
              });
            }}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
