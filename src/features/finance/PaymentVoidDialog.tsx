import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Label } from "../../ui/Label";
import { Textarea } from "../../ui/Textarea";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { PAYMENT_VOID_SQL } from "../../services/apiPayments";
import { assessErroneousPaymentVoid, validatePaymentVoidReason } from "./paymentVoid";
import type { LedgerPayment } from "./paymentTypes";
import { useRecordPaymentVoid } from "./usePayments";

type PaymentVoidDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: LedgerPayment | null;
  allPayments: LedgerPayment[];
  canRecord: boolean;
};

/**
 * Distinguishes erroneous (never received) payments from real refunds.
 * Confirms with a required reason, then inserts kind=void (append-only).
 */
export function PaymentVoidDialog({ open, onOpenChange, payment, allPayments, canRecord }: PaymentVoidDialogProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const { mutate: recordVoid, isPending } = useRecordPaymentVoid();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const assessment = payment
    ? assessErroneousPaymentVoid(payment, allPayments, { canRecord })
    : { allowed: false as const, reason: "not_a_payment" as const };

  const canConfirm = Boolean(payment) && assessment.allowed === true && !isPending;

  function handleOpenChange(next: boolean) {
    if (!next) {
      setReason("");
      setReasonError(null);
    }
    onOpenChange(next);
  }

  function handleSubmit() {
    if (!payment || isPending) return;
    const code = validatePaymentVoidReason(reason);
    if (code === "required") {
      setReasonError(t("finance.payments.void.validation.reasonRequired"));
      return;
    }
    if (code === "too_short") {
      setReasonError(t("finance.payments.void.validation.reasonTooShort"));
      return;
    }
    if (assessment.allowed !== true) {
      setReasonError(
        assessment.reason === "already_offset"
          ? t("finance.payments.void.errors.alreadyOffset")
          : assessment.reason === "not_a_payment"
            ? t("finance.payments.void.errors.notAPayment")
            : assessment.reason === "no_permission"
              ? t("finance.payments.errors.noPermission")
              : t("finance.payments.void.errors.schemaUnsupported", { file: PAYMENT_VOID_SQL }),
      );
      return;
    }

    recordVoid(
      { originalPaymentId: payment.id, reason: reason.trim() },
      {
        onSuccess: () => handleOpenChange(false),
        onError: (error) => setReasonError(error.message),
      },
    );
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

            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>{t("finance.payments.void.pointHistory")}</li>
              <li>{t("finance.payments.void.pointInvoiceOrder")}</li>
              <li>{t("finance.payments.void.pointDeleteLater")}</li>
            </ul>

            {assessment.allowed === false ? (
              <p className="text-sm text-warning" role="status">
                {assessment.reason === "already_offset"
                  ? t("finance.payments.void.errors.alreadyOffset")
                  : assessment.reason === "not_a_payment"
                    ? t("finance.payments.void.errors.notAPayment")
                    : assessment.reason === "no_permission"
                      ? t("finance.payments.errors.noPermission")
                      : t("finance.payments.void.errors.schemaUnsupported", { file: PAYMENT_VOID_SQL })}
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
                disabled={isPending || assessment.allowed !== true}
                aria-invalid={Boolean(reasonError)}
              />
              {reasonError ? <p className="text-xs text-destructive">{reasonError}</p> : null}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={!canConfirm} onClick={handleSubmit}>
            {isPending ? t("common.saving") : t("finance.payments.void.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
