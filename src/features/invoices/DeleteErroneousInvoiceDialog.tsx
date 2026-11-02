import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import type { Invoice } from "../../lib/types";
import { useDeleteErroneousInvoice } from "./useDeleteErroneousInvoice";

type DeleteErroneousInvoiceDialogProps = {
  invoice: Invoice | null;
  onClose: () => void;
  onDeleted?: () => void;
};

export function DeleteErroneousInvoiceDialog({ invoice, onClose, onDeleted }: DeleteErroneousInvoiceDialogProps) {
  const { t } = useTranslation();
  const deleteInvoice = useDeleteErroneousInvoice();

  return (
    <Dialog
      open={Boolean(invoice)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md" onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t("invoices.erroneous.deleteTitle")}</DialogTitle>
          <DialogDescription>
            {t("invoices.erroneous.deleteDescription", { number: invoice?.invoiceNumber ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t("invoices.erroneous.deletePointInvoiceOnly")}</li>
          <li>{t("invoices.erroneous.deletePointOrderKept")}</li>
          <li>{t("invoices.erroneous.deletePointNumber")}</li>
        </ul>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={deleteInvoice.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!invoice || deleteInvoice.isPending}
            onClick={() => {
              if (!invoice) return;
              deleteInvoice.mutate(invoice.id, {
                onSuccess: () => {
                  onClose();
                  onDeleted?.();
                },
              });
            }}
          >
            {deleteInvoice.isPending ? t("common.deleting") : t("invoices.actions.deleteErroneous")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
