import { Trans, useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
          <DialogTitle>{t("inventory.dialogs.deleteTitle")}</DialogTitle>
          <DialogDescription>{t("inventory.dialogs.deleteDescription")}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          <Trans i18nKey="inventory.dialogs.deleteConfirm" values={{ name: item?.name }} components={{ strong: <strong className="text-foreground" /> }} />
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
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
            {isDeleting ? t("common.deleting") : t("common.delete")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
