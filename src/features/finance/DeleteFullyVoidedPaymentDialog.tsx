import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { assessDeleteFullyVoidedPayment } from "./paymentVoid";
import type { LedgerPayment } from "./paymentTypes";
import { useDeleteFullyVoidedPayment } from "./usePayments";

type DeleteFullyVoidedPaymentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: LedgerPayment | null;
  allPayments: LedgerPayment[];
  canRecord: boolean;
};

/**
 * Optional cleanup after a full void. Deletes only the payment + its void rows.
 * Never deletes invoices or orders.
 */
export function DeleteFullyVoidedPaymentDialog({
  open,
  onOpenChange,
  payment,
  allPayments,
  canRecord,
}: DeleteFullyVoidedPaymentDialogProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const { mutate: deletePayment, isPending } = useDeleteFullyVoidedPayment();

  const assessment = payment
    ? assessDeleteFullyVoidedPayment(payment, allPayments, { canRecord })
    : { allowed: false as const, reason: "not_a_payment" as const };

  const canConfirm = Boolean(payment) && assessment.allowed === true && !isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("finance.payments.void.deleteTitle")}</DialogTitle>
          <DialogDescription>
            {payment
              ? t("finance.payments.void.deleteDescription", { amount: formatMoney(payment.amount) })
              : null}
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t("finance.payments.void.deletePointPaymentOnly")}</li>
          <li>{t("finance.payments.void.deletePointInvoiceKept")}</li>
          <li>{t("finance.payments.void.deletePointOrderKept")}</li>
        </ul>

        {assessment.allowed === false ? (
          <p className="text-sm text-warning" role="status">
            {assessment.reason === "not_fully_voided"
              ? t("finance.payments.void.errors.deleteRequiresFullVoid")
              : assessment.reason === "no_permission"
                ? t("finance.payments.errors.noPermission")
                : t("finance.payments.void.errors.notAPayment")}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canConfirm}
            onClick={() => {
              if (!payment) return;
              deletePayment(payment.id, { onSuccess: () => onOpenChange(false) });
            }}
          >
            {isPending ? t("common.deleting") : t("finance.payments.void.deleteConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
