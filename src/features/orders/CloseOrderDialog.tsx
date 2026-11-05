import { useMemo } from "react";
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
import type { Order } from "../../lib/types";
import type { CloseOrderResult } from "../../services/apiOrders";
import type { LedgerPayment } from "../finance/paymentTypes";
import { orderPaymentBalance } from "../finance/paymentCalculations";
import { isOrderFormallyClosed } from "./orderLifecycle";
import { useCloseOrder } from "./useCloseOrder";

type CloseOrderDialogProps = {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payments: LedgerPayment[];
  invoiceId?: string | null;
  formatMoney: (amount: number) => string;
  /** Called after a successful close so detail/list local state can show status=closed immediately. */
  onClosed?: (result: CloseOrderResult) => void;
};

/**
 * Explicit Close order confirmation. Shows ledger remaining; blocks confirm when unsettled.
 * Does not record a payment — user settles via the payment UI first when needed.
 */
export function CloseOrderDialog({
  order,
  open,
  onOpenChange,
  payments,
  invoiceId,
  formatMoney,
  onClosed,
}: CloseOrderDialogProps) {
  const { t } = useTranslation();
  const closeOrder = useCloseOrder();

  const balance = useMemo(() => {
    if (!order) return null;
    return orderPaymentBalance(order, payments, invoiceId);
  }, [order, payments, invoiceId]);

  if (!order) return null;

  const alreadyClosed = isOrderFormallyClosed(order);
  const remaining = balance?.remaining ?? order.totalPrice;
  const zeroTotal = (order.totalPrice ?? 0) <= 0.005;
  // Match RPC: zero total may close without ledger; positive total needs ledger proof + remaining≈0.
  const canClose =
    alreadyClosed || (remaining <= 0.005 && (zeroTotal || Boolean(balance?.hasLedger)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t("orders.lifecycle.closeTitle")}</DialogTitle>
          <DialogDescription>
            {t("orders.lifecycle.closeDescription", { number: order.orderNumber })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">{t("orders.lifecycle.orderTotal")}</span>
            <span className="font-medium tabular-nums">{formatMoney(order.totalPrice)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">{t("orders.lifecycle.netPaid")}</span>
            <span className="font-medium tabular-nums">{formatMoney(balance?.netPaid ?? 0)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">{t("orders.lifecycle.remaining")}</span>
            <span className={`font-medium tabular-nums ${remaining > 0.005 ? "text-destructive" : "text-success"}`}>
              {formatMoney(remaining)}
            </span>
          </div>
          {alreadyClosed && order.closedAt ? (
            <p className="text-xs text-muted-foreground">
              {t("orders.lifecycle.closedAt", { date: order.closedAt })}
            </p>
          ) : null}
          {!canClose ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {t("orders.lifecycle.blockedOutstanding", { amount: formatMoney(remaining) })}
            </p>
          ) : null}
          {canClose && !alreadyClosed && zeroTotal ? (
            <p className="text-xs text-muted-foreground">{t("orders.lifecycle.zeroTotalHint")}</p>
          ) : null}
          {canClose && !alreadyClosed && !zeroTotal && !(balance?.hasLedger) ? (
            <p className="text-xs text-muted-foreground">{t("orders.lifecycle.legacyPaidHint")}</p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canClose || closeOrder.isPending}
            onClick={() => {
              closeOrder.mutate(order.id, {
                onSuccess: (result) => {
                  onClosed?.(result);
                  onOpenChange(false);
                },
              });
            }}
          >
            {closeOrder.isPending ? t("common.saving") : alreadyClosed ? t("orders.lifecycle.confirmAlreadyClosed") : t("orders.lifecycle.confirmClose")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
