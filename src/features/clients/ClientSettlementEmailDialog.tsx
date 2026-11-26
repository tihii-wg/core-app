import { useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { Copy, Mail, Printer, Share2 } from "lucide-react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Skeleton } from "../../ui/Skeleton";

type ClientSettlementEmailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultRecipient: string;
  companyName: string;
  text: string;
  loading: boolean;
  error: boolean;
  onPrint: () => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sends the statement through the user's own mail app (mailto with the statement as the message text) or the phone
 * share sheet. Core App has no server-side mail sender, so nothing is sent silently on the user's behalf.
 * Mounted only while open (the recipient starts from the client's e-mail each time).
 */
export function ClientSettlementEmailDialog({ open, onOpenChange, defaultRecipient, companyName, text, loading, error, onPrint }: ClientSettlementEmailDialogProps) {
  const { t } = useTranslation();
  const [recipient, setRecipient] = useState(defaultRecipient);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const subject = t("clients.settlement.emailDialog.subjectValue", { company: companyName });
  const trimmed = recipient.trim();
  const recipientValid = EMAIL_RE.test(trimmed);
  const ready = !loading && !error && text !== "";

  const openMail = () => {
    window.location.href = `mailto:${encodeURIComponent(trimmed)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  };

  const share = async () => {
    try {
      await navigator.share({ title: subject, text });
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") toast.error((cause as Error).message);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${text}`);
      toast.success(t("clients.settlement.emailDialog.copied"));
    } catch (cause) {
      toast.error((cause as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-hidden p-4 sm:max-w-lg sm:p-6">
        <DialogHeader className="min-w-0 flex-none">
          <DialogTitle>{t("clients.settlement.emailDialog.title")}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">{t("clients.settlement.emailDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="settlement-email-recipient">{t("clients.settlement.emailDialog.recipient")}</Label>
            <Input
              id="settlement-email-recipient"
              type="email"
              inputMode="email"
              autoComplete="email"
              className="w-full min-w-0"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder={t("clients.settlement.emailDialog.recipientPlaceholder")}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-medium text-foreground">{t("clients.settlement.emailDialog.subject")}</p>
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{subject}</p>
          </div>
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-medium text-foreground">{t("clients.settlement.emailDialog.preview")}</p>
            {loading ? (
              <Skeleton className="h-40 w-full" />
            ) : error ? (
              <p className="text-sm text-destructive">{t("clients.settlement.emailDialog.companyFailed")}</p>
            ) : (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/50 p-3 font-sans text-xs text-foreground [overflow-wrap:anywhere]">
                {text}
              </pre>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t("clients.settlement.emailDialog.pdfHint")}</p>
        </div>

        <DialogFooter className="min-w-0 flex-none flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onPrint}>
            <Printer />
            {t("clients.settlement.print")}
          </Button>
          <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={!ready} onClick={copy}>
            <Copy />
            {t("clients.settlement.emailDialog.copy")}
          </Button>
          {canShare ? (
            <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={!ready} onClick={share}>
              <Share2 />
              {t("clients.settlement.emailDialog.share")}
            </Button>
          ) : null}
          <Button type="button" className="w-full sm:w-auto" disabled={!ready || !recipientValid} onClick={openMail}>
            <Mail />
            {t("clients.settlement.emailDialog.openMail")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
