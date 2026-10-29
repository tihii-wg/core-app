import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Label } from "../../ui/Label";
import { Textarea } from "../../ui/Textarea";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import {
  assessErroneousPaymentVoid,
  PAYMENT_VOID_SCHEMA_SUPPORTED,
  validatePaymentVoidReason,
} from "./paymentVoid";
import type { LedgerPayment } from "./paymentTypes";

type PaymentVoidDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: LedgerPayment | null;
  allPayments: LedgerPayment[];
  canRecord: boolean;
};

/**
 * Distinguishes erroneous (never received) payments from real refunds.
 * Confirmation + required reason are ready; submit stays blocked until schema supports void.
 */
export function PaymentVoidDialog({ open, onOpenChange, payment, allPayments, canRecord }: PaymentVoidDialogProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const assessment = payment
    ? assessErroneousPaymentVoid(payment, allPayments, { canRecord })
    : { allowed: false as const, reason: "schema_unsupported" as const };

  /** Business-eligible aside from missing DB void support (confirm still validates reason). */
  const canAttemptConfirm =
    Boolean(payment) &&
    canRecord &&
    (assessment.allowed || (assessment.allowed === false && assessment.reason === "schema_unsupported"));

  function handleOpenChange(next: boolean) {
    if (!next) {
      setReason("");
      setReasonError(null);
    }
    onOpenChange(next);
  }

  function handleSubmit() {
    const code = validatePaymentVoidReason(reason);
    if (code === "required") {
      setReasonError(t("finance.payments.void.validation.reasonRequired"));
      return;
    }
    if (code === "too_short") {
      setReasonError(t("finance.payments.void.validation.reasonTooShort"));
      return;
    }
    // Schema gate — never insert a fake void / silent delete / auto-refund.
    if (!PAYMENT_VOID_SCHEMA_SUPPORTED || assessment.allowed !== true) {
      setReasonError(t("finance.payments.void.errors.schemaUnsupported"));
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("finance.payments.void.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("finance.payments.void.dialogDescription")}</DialogDescription>
        </DialogHeader>

        {payment ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <p className="font-medium tabular-nums text-foreground">{formatMoney(payment.amount)}</p>
              <p className="mt-1 text-muted-foreground">{t("finance.payments.void.vsRefund")}</p>
            </div>

            {!PAYMENT_VOID_SCHEMA_SUPPORTED || !assessment.allowed ? (
              <p className="text-sm text-warning" role="status">
                {assessment.allowed === false && assessment.reason === "already_offset"
                  ? t("finance.payments.void.errors.alreadyOffset")
                  : assessment.allowed === false && assessment.reason === "not_a_payment"
                    ? t("finance.payments.void.errors.notAPayment")
                    : assessment.allowed === false && assessment.reason === "no_permission"
                      ? t("finance.payments.errors.noPermission")
                      : t("finance.payments.void.errors.schemaUnsupported")}
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="payment-void-reason">{t("finance.payments.void.fields.reason")}</Label>
              <Textarea
                id="payment-void-reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonError(null);
                }}
                rows={3}
                maxLength={500}
                aria-invalid={Boolean(reasonError)}
              />
              {reasonError ? <p className="text-xs text-destructive">{reasonError}</p> : null}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={!canAttemptConfirm} onClick={handleSubmit}>
            {t("finance.payments.void.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
