import { Ban, EllipsisVertical, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../ui/DropdownMenu";
import { refundableRemaining } from "./paymentCalculations";
import { assessErroneousPaymentVoid } from "./paymentVoid";
import type { LedgerPayment } from "./paymentTypes";

type PaymentActionsMenuProps = {
  payment: LedgerPayment;
  allPayments: LedgerPayment[];
  canRecord: boolean;
  onRefund: (payment: LedgerPayment) => void;
  onVoidErroneous: (payment: LedgerPayment) => void;
  /** Extra classes for the trigger (e.g. a larger touch target on mobile). */
  triggerClassName?: string;
};

/**
 * Finance ledger payment/refund row menu.
 * - Record refund: money was received and returned (supported).
 * - Void erroneous: money was never received (dialog explains schema gate; no silent delete).
 */
export function PaymentActionsMenu({
  payment,
  allPayments,
  canRecord,
  onRefund,
  onVoidErroneous,
  triggerClassName,
}: PaymentActionsMenuProps) {
  const { t } = useTranslation();
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const refundable = payment.kind === "payment" ? refundableRemaining(payment, allPayments) : 0;
  const canRefund = canRecord && payment.kind === "payment" && refundable > 0;
  const voidAssessment = assessErroneousPaymentVoid(payment, allPayments, { canRecord });
  const showVoidEntry =
    payment.kind === "payment" &&
    (voidAssessment.allowed ||
      voidAssessment.reason === "schema_unsupported" ||
      voidAssessment.reason === "already_offset" ||
      voidAssessment.reason === "no_permission");

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={triggerClassName}
          aria-label={t("finance.payments.actions.menuLabel", {
            kind: t(`finance.payments.kinds.${payment.kind}`),
          })}
          onClick={stop}
        >
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" onClick={stop}>
        {canRefund ? (
          <DropdownMenuItem onSelect={() => onRefund(payment)}>
            <RotateCcw />
            {t("finance.payments.refund")}
          </DropdownMenuItem>
        ) : null}

        {showVoidEntry ? (
          <>
            {canRefund ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              disabled={voidAssessment.allowed === false && voidAssessment.reason === "no_permission"}
              onSelect={() => onVoidErroneous(payment)}
            >
              <Ban />
              {t("finance.payments.void.action")}
            </DropdownMenuItem>
          </>
        ) : null}

        {!canRefund && !showVoidEntry ? (
          <DropdownMenuItem disabled>{t("finance.payments.actions.noActions")}</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
