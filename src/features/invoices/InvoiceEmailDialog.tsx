import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Mail } from "lucide-react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import type { InvoiceDocument } from "../../lib/types";

type InvoiceEmailDialogProps = {
  invoice: InvoiceDocument | null;
  onClose: () => void;
  onDownloadPdf: () => void;
};

/**
 * Manual email fallback. Core App has no secure server-side email
 * provider/endpoint, so the client must never pretend to send mail
 * directly: the user downloads the PDF, then this dialog opens their
 * own mail app with a prefilled subject/body so they can attach it.
 */
export function InvoiceEmailDialog({ invoice, onClose, onDownloadPdf }: InvoiceEmailDialogProps) {
  const { t } = useTranslation();
  const [recipient, setRecipient] = useState("");
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (invoice) {
      setRecipient("");
      setOpened(false);
    }
  }, [invoice]);

  if (!invoice) return null;

  const subject = t("invoices.email.subject", { number: invoice.invoiceNumber });
  const body = t("invoices.email.body", { number: invoice.invoiceNumber, client: invoice.clientName });
  const mailto = `mailto:${encodeURIComponent(recipient.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const recipientValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim());

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100vw-2rem)] [grid-template-columns:minmax(0,1fr)] overflow-y-auto overscroll-contain sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="min-w-0 [overflow-wrap:anywhere]">{t("invoices.email.title", { number: invoice.invoiceNumber })}</DialogTitle>
          <DialogDescription className="min-w-0 [overflow-wrap:anywhere]">{t("invoices.email.description")}</DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="invoice-email-recipient">{t("invoices.email.recipient")}</Label>
            <Input
              id="invoice-email-recipient"
              type="email"
              className="w-full min-w-0"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder={t("invoices.email.recipientPlaceholder")}
            />
          </div>

          <ol className="min-w-0 list-decimal space-y-1.5 rounded-lg border border-border bg-muted/50 px-5 py-3.5 text-sm text-muted-foreground [overflow-wrap:anywhere] sm:px-6">
            <li>{t("invoices.email.stepDownload")}</li>
            <li>{t("invoices.email.stepOpen")}</li>
            <li>{t("invoices.email.stepAttach")}</li>
          </ol>

          {opened ? <p className="min-w-0 text-sm text-success [overflow-wrap:anywhere]">{t("invoices.email.opened")}</p> : null}
        </div>

        <DialogFooter className="min-w-0 flex-col-reverse sm:flex-row sm:flex-wrap sm:justify-end">
          <Button variant="outline" className="w-full min-w-0 whitespace-normal sm:w-auto" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="outline" className="w-full min-w-0 whitespace-normal sm:w-auto" onClick={onDownloadPdf}>
            <Download />
            {t("invoices.actions.downloadPdf")}
          </Button>
          <Button
            className="w-full min-w-0 whitespace-normal sm:w-auto"
            disabled={!recipientValid}
            onClick={() => {
              setOpened(true);
              window.location.href = mailto;
            }}
          >
            <Mail />
            {t("invoices.email.openMailApp")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
