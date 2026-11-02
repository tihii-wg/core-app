import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import type { Invoice } from "../../lib/types";
import { useUpdateInvoiceStatus } from "./useUpdateInvoiceStatus";

type MarkErroneousInvoiceDialogProps = {
  invoice: Invoice | null;
  onClose: () => void;
};

export function MarkErroneousInvoiceDialog({ invoice, onClose }: MarkErroneousInvoiceDialogProps) {
  const { t } = useTranslation();
  const updateStatus = useUpdateInvoiceStatus();

  return (
    <Dialog
      open={Boolean(invoice)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md" onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t("invoices.erroneous.markTitle")}</DialogTitle>
          <DialogDescription>
            {t("invoices.erroneous.markDescription", { number: invoice?.invoiceNumber ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t("invoices.erroneous.markPointPreserve")}</li>
          <li>{t("invoices.erroneous.markPointInvalid")}</li>
          <li>{t("invoices.erroneous.markPointOrder")}</li>
        </ul>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={updateStatus.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!invoice || updateStatus.isPending}
            onClick={() => {
              if (!invoice) return;
              updateStatus.mutate(
                { invoiceId: invoice.id, status: "erroneous" },
                { onSuccess: () => onClose() },
              );
            }}
          >
            {updateStatus.isPending ? t("common.saving") : t("invoices.actions.markErroneous")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
