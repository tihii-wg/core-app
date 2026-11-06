import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/Dialog";
import { Label } from "../../ui/Label";
import { Textarea } from "../../ui/Textarea";
import type { Order } from "../../lib/types";
import type { CancelOrderWithPaymentVoidResult } from "../../services/apiOrders";
import { useGetPayments } from "../finance/usePayments";
import { financeDateKey } from "../finance/financeStats";
import { useReportFormatting } from "../reports/reportFormatting";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import {
  activePaymentsBlockingOrderDelete,
  refundsBlockingOrderDelete,
} from "./orderDeletionEligibility";
import { useCancelOrder } from "./useCloseOrder";

type CancelOrderDialogProps = {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancelled?: (result: CancelOrderWithPaymentVoidResult) => void;
};

function stopBubble(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

const MIN_REASON_LENGTH = 8;

export function CancelOrderDialog({ order, open, onOpenChange, onCancelled }: CancelOrderDialogProps) {
  const { t } = useTranslation();
  const { payments } = useGetPayments();
  const { formatMoney } = useWorkspaceMoney();
  const { formatDate } = useReportFormatting();
  const cancelOrder = useCancelOrder();
  const [voidPayments, setVoidPayments] = useState(true);
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);

  const orderId = order?.id ?? "";
  const orderNumber = order?.orderNumber ?? "";

  const activePayments = useMemo(() => {
    if (!orderId) return [];
    return activePaymentsBlockingOrderDelete(payments, orderId).filter((row) => row.kind === "payment");
  }, [payments, orderId]);

  const refundedPayments = useMemo(() => {
    if (!orderId) return [];
    return refundsBlockingOrderDelete(payments, orderId);
  }, [payments, orderId]);

  const paymentsTotal = useMemo(
    () => activePayments.reduce((sum, row) => sum + row.amount, 0),
    [activePayments],
  );

  const hasActivePayments = activePayments.length > 0;
  const reasonValue = reason.trim();
  const reasonTooShort = voidPayments && hasActivePayments && reasonValue.length < MIN_REASON_LENGTH;
  const confirmDisabled = cancelOrder.isPending || reasonTooShort;

  useEffect(() => {
    if (!open || !order) return;
    setVoidPayments(true);
    setReason(t("orders.cancelFinance.defaultReason", { number: order.orderNumber }));
    setReasonTouched(false);
  }, [open, order, t]);

  function handleConfirm() {
    if (!order || confirmDisabled) return;
    cancelOrder.mutate(
      {
        orderId: order.id,
        voidPayments: hasActivePayments ? voidPayments : false,
        reason: hasActivePayments && voidPayments ? reasonValue : null,
      },
      {
        onSuccess: (result) => {
          onOpenChange(false);
          onCancelled?.(result);
        },
      },
    );
  }

  return (
    <Dialog
      open={open && Boolean(order)}
      onOpenChange={(next) => {
        if (cancelOrder.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md" onClick={stopBubble} onPointerDown={stopBubble}>
        <DialogHeader>
          <DialogTitle>{t("orders.lifecycle.cancelTitle")}</DialogTitle>
          <DialogDescription>
            {t("orders.lifecycle.cancelDescription", { number: orderNumber })}
          </DialogDescription>
        </DialogHeader>

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
                id="cancel-void-payments"
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 rounded border border-input"
                checked={voidPayments}
                disabled={cancelOrder.isPending}
                onChange={(event) => setVoidPayments(event.target.checked)}
              />
              <Label htmlFor="cancel-void-payments" className="text-sm font-normal leading-snug">
                {t("orders.cancelFinance.voidPayments")}
              </Label>
            </div>
            <p className="text-sm text-muted-foreground">{t("orders.cancelFinance.voidHint")}</p>

            {voidPayments ? (
              <div className="space-y-1.5">
                <Label htmlFor="cancel-void-reason">{t("orders.cancelFinance.reasonLabel")}</Label>
                <Textarea
                  id="cancel-void-reason"
                  value={reason}
                  disabled={cancelOrder.isPending}
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

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={cancelOrder.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={confirmDisabled} onClick={handleConfirm}>
            {cancelOrder.isPending
              ? t("common.saving")
              : hasActivePayments && voidPayments
                ? t("orders.cancelFinance.confirmWithVoid")
                : t("orders.lifecycle.confirmCancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
