import { Trans, useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import type { Client } from "../../lib/types";
import { useDeleteClient } from "./useDeleteClient";

type DeleteClientDialogProps = {
  client: Client | null;
  onClose: () => void;
  onDeleted?: (clientId: string) => void;
};

export function DeleteClientDialog({ client, onClose, onDeleted }: DeleteClientDialogProps) {
  const { t } = useTranslation();
  const { mutate: deleteClient, isPending } = useDeleteClient();

  return (
    <Dialog
      open={Boolean(client)}
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("clients.delete.title")}</DialogTitle>
          <DialogDescription>{t("clients.delete.description")}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          <Trans
            i18nKey="clients.delete.confirm"
            values={{ name: client?.name }}
            components={{ strong: <strong className="text-foreground" /> }}
          />
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending || !client}
            onClick={() => {
              if (!client || isPending) return;
              deleteClient(client.id, {
                onSuccess: () => {
                  onDeleted?.(client.id);
                  onClose();
                },
              });
            }}
          >
            {isPending ? t("common.deleting") : t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
