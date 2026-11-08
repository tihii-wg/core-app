import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "../../ui/Label";
import { Textarea } from "../../ui/Textarea";
import type { Order } from "../../lib/types";
import { useGetPayments } from "../finance/usePayments";
import { financeDateKey } from "../finance/financeStats";
import { useReportFormatting } from "../reports/reportFormatting";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import {
  activePaymentsBlockingOrderDelete,
  refundsBlockingOrderDelete,
} from "./orderDeletionEligibility";

export type CancelOrderConfirmPayload = {
  orderId: string;
  voidPayments: boolean;
  reason: string | null;
};

const MIN_REASON_LENGTH = 8;

type CancelOrderStepBodyProps = {
  order: Order;
  open: boolean;
  busy: boolean;
  /** Optional id prefix so multiple mounts do not collide. */
  idPrefix?: string;
  onValidityChange?: (valid: boolean) => void;
  /** Expose current payload for parent confirm button. */
  onPayloadChange?: (payload: CancelOrderConfirmPayload | null) => void;
};

/**
 * Shared cancel-order fields (payments list, void checkbox, reason).
 * Parent owns Dialog chrome and confirm/cancel buttons.
 */
export function CancelOrderStepBody({
  order,
  open,
  busy,
  idPrefix = "cancel-order",
  onValidityChange,
  onPayloadChange,
}: CancelOrderStepBodyProps) {
  const { t } = useTranslation();
  const { payments } = useGetPayments();
  const { formatMoney } = useWorkspaceMoney();
  const { formatDate } = useReportFormatting();
  const [voidPayments, setVoidPayments] = useState(true);
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);

  const orderId = order.id;

  const activePayments = useMemo(() => {
    return activePaymentsBlockingOrderDelete(payments, orderId).filter((row) => row.kind === "payment");
  }, [payments, orderId]);

  const refundedPayments = useMemo(() => {
    return refundsBlockingOrderDelete(payments, orderId);
  }, [payments, orderId]);

  const paymentsTotal = useMemo(
    () => activePayments.reduce((sum, row) => sum + row.amount, 0),
    [activePayments],
  );

  const hasActivePayments = activePayments.length > 0;
  const reasonValue = reason.trim();
  const reasonTooShort = voidPayments && hasActivePayments && reasonValue.length < MIN_REASON_LENGTH;
  const confirmValid = !reasonTooShort;

  useEffect(() => {
    if (!open) return;
    setVoidPayments(true);
    setReason(t("orders.cancelFinance.defaultReason", { number: order.orderNumber }));
    setReasonTouched(false);
  }, [open, order.id, order.orderNumber, t]);

  useEffect(() => {
    onValidityChange?.(confirmValid);
  }, [confirmValid, onValidityChange]);

  useEffect(() => {
    if (!confirmValid) {
      onPayloadChange?.(null);
      return;
    }
    onPayloadChange?.({
      orderId,
      voidPayments: hasActivePayments ? voidPayments : false,
      reason: hasActivePayments && voidPayments ? reasonValue : null,
    });
  }, [confirmValid, hasActivePayments, onPayloadChange, orderId, reasonValue, voidPayments]);

  return (
    <div className="space-y-4">
      {hasActivePayments ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{t("orders.cancelFinance.paymentsTitle")}</p>
            <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {activePayments.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 text-muted-foreground">
                    {formatDate(financeDateKey(payment.paidAt))}
                    {" · "}
                    {t(`finance.paymentMethods.short.${payment.paymentMethod}`)}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums text-foreground">{formatMoney(payment.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm font-medium tabular-nums text-foreground">{formatMoney(paymentsTotal)}</p>
          </div>

          <div className="flex items-start gap-2">
            <input
              id={`${idPrefix}-void-payments`}
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 rounded border border-input"
              checked={voidPayments}
              disabled={busy}
              onChange={(event) => setVoidPayments(event.target.checked)}
            />
            <Label htmlFor={`${idPrefix}-void-payments`} className="text-sm font-normal leading-snug">
              {t("orders.cancelFinance.voidPayments")}
            </Label>
          </div>
          <p className="text-sm text-muted-foreground">{t("orders.cancelFinance.voidHint")}</p>

          {voidPayments ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-void-reason`}>{t("orders.cancelFinance.reasonLabel")}</Label>
              <Textarea
                id={`${idPrefix}-void-reason`}
                value={reason}
                disabled={busy}
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonTouched(true);
                }}
                rows={3}
              />
              {reasonTouched && reasonTooShort ? (
                <p className="text-sm text-destructive" role="alert">
                  {t("orders.cancelFinance.reasonTooShort")}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {refundedPayments.length > 0 ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground" role="status">
          {t("orders.cancelFinance.refundedWarning", { count: refundedPayments.length })}
        </p>
      ) : null}
    </div>
  );
}

/** Whether the cancel form currently has active payments that would be voided (for button label). */
export function useCancelOrderHasActivePayments(orderId: string | undefined): {
  hasActivePayments: boolean;
} {
  const { payments } = useGetPayments();
  const hasActivePayments = useMemo(() => {
    if (!orderId) return false;
    return activePaymentsBlockingOrderDelete(payments, orderId).some((row) => row.kind === "payment");
  }, [payments, orderId]);
  return { hasActivePayments };
}
