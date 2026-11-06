import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
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
import type { Order } from "../../lib/types";
import type { CloseOrderResult } from "../../services/apiOrders";
import type { LedgerPayment, PaymentBalance } from "../finance/paymentTypes";
import { orderPaymentBalance } from "../finance/paymentCalculations";
import { OrderPaymentForm } from "../finance/PaymentFormDialog";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { isOrderFormallyClosed } from "./orderLifecycle";
import { useCloseOrder } from "./useCloseOrder";

type CloseOrderDialogProps = {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payments: LedgerPayment[];
  invoiceId?: string | null;
  formatMoney: (amount: number) => string;
  /** When true, unsettled orders can record a ledger payment from this dialog. */
  canRecordPayment?: boolean;
  /** Called after a successful close so detail/list local state can show status=closed immediately. */
  onClosed?: (result: CloseOrderResult) => void;
};

/** Match PaymentHistorySection: legacy paid-with-no-ledger still needs a first ledger row up to total. */
function recordableBalance(balance: PaymentBalance): PaymentBalance {
  return balance.isLegacyUnreconciled
    ? { ...balance, remaining: balance.total, netPaid: 0, status: "unpaid" }
    : balance;
}

function paymentsFromCache(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string | undefined,
): LedgerPayment[] | null {
  if (!workspaceId) return null;
  const entries = queryClient.getQueriesData<LedgerPayment[]>({ queryKey: ["payments", workspaceId] });
  for (const [, data] of entries) {
    if (Array.isArray(data)) return data;
  }
  return null;
}

/**
 * Explicit Close order confirmation. Shows ledger remaining; when unsettled and
 * `canRecordPayment`, embeds OrderPaymentForm so the user can settle (and optionally
 * close) without opening the order card.
 */
export function CloseOrderDialog({
  order,
  open,
  onOpenChange,
  payments,
  invoiceId,
  formatMoney,
  canRecordPayment = false,
  onClosed,
}: CloseOrderDialogProps) {
  const { t } = useTranslation();
  const closeOrder = useCloseOrder();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const [closeAfterPayment, setCloseAfterPayment] = useState(true);
  const [paymentsOverride, setPaymentsOverride] = useState<LedgerPayment[] | null>(null);

  useEffect(() => {
    if (!open) {
      setPaymentsOverride(null);
      setCloseAfterPayment(true);
    }
  }, [open, order?.id]);

  const effectivePayments = paymentsOverride ?? payments;

  const balance = useMemo(() => {
    if (!order) return null;
    return orderPaymentBalance(order, effectivePayments, invoiceId);
  }, [order, effectivePayments, invoiceId]);

  const recordable = balance ? recordableBalance(balance) : null;

  if (!order) return null;

  const alreadyClosed = isOrderFormallyClosed(order);
  const displayRemaining = balance?.remaining ?? order.totalPrice;
  const recordableRemaining = recordable?.remaining ?? displayRemaining;
  const zeroTotal = (order.totalPrice ?? 0) <= 0.005;
  // Match RPC: zero total may close without ledger; positive total needs ledger proof + remaining≈0.
  const canClose =
    alreadyClosed || (displayRemaining <= 0.005 && (zeroTotal || Boolean(balance?.hasLedger)));

  const blockedByOutstanding = !canClose && !alreadyClosed;
  const showPaymentForm = blockedByOutstanding && canRecordPayment && recordableRemaining > 0.005;

  async function handlePaymentRecorded(_amount: number) {
    if (!order) return;
    const currentOrder = order;

    await queryClient.refetchQueries({ queryKey: ["payments", workspaceId] });
    const fresh = paymentsFromCache(queryClient, workspaceId) ?? effectivePayments;
    setPaymentsOverride(fresh);

    const nextBalance = orderPaymentBalance(currentOrder, fresh, invoiceId);
    const nextRecordable = recordableBalance(nextBalance);

    if (nextRecordable.remaining > 0.005) {
      toast.success(
        t("orders.lifecycle.partialPaymentRemaining", { amount: formatMoney(nextRecordable.remaining) }),
      );
      return;
    }

    if (!closeAfterPayment) {
      onOpenChange(false);
      return;
    }

    try {
      const result = await closeOrder.mutateAsync(currentOrder.id);
      onClosed?.(result);
      onOpenChange(false);
    } catch {
      // Payment stays recorded; close toast already shown by useCloseOrder. Keep dialog for retry.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={showPaymentForm ? "max-h-[90vh] max-w-lg overflow-y-auto" : "max-w-md"}
        onClick={(event) => event.stopPropagation()}
      >
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
            <span className="font-medium tabular-nums">
              {formatMoney(showPaymentForm ? (recordable?.netPaid ?? 0) : (balance?.netPaid ?? 0))}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">{t("orders.lifecycle.remaining")}</span>
            <span
              className={`font-medium tabular-nums ${
                (showPaymentForm ? recordableRemaining : displayRemaining) > 0.005
                  ? "text-destructive"
                  : "text-success"
              }`}
            >
              {formatMoney(showPaymentForm ? recordableRemaining : displayRemaining)}
            </span>
          </div>
          {alreadyClosed && order.closedAt ? (
            <p className="text-xs text-muted-foreground">
              {t("orders.lifecycle.closedAt", { date: order.closedAt })}
            </p>
          ) : null}
          {blockedByOutstanding && !showPaymentForm ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {t("orders.lifecycle.blockedOutstanding", { amount: formatMoney(displayRemaining) })}
            </p>
          ) : null}
          {showPaymentForm ? (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
              {t("orders.lifecycle.recordPaymentToClose")}
            </p>
          ) : null}
          {canClose && !alreadyClosed && zeroTotal ? (
            <p className="text-xs text-muted-foreground">{t("orders.lifecycle.zeroTotalHint")}</p>
          ) : null}
          {canClose && !alreadyClosed && !zeroTotal && !balance?.hasLedger ? (
            <p className="text-xs text-muted-foreground">{t("orders.lifecycle.legacyPaidHint")}</p>
          ) : null}
        </div>

        {showPaymentForm && recordable ? (
          <div className="space-y-3 border-t border-border pt-3">
            <OrderPaymentForm
              key={`${order.id}:${recordableRemaining}`}
              orderId={order.id}
              invoiceId={invoiceId}
              balance={recordable}
              showCancelButton={false}
              onDone={() => undefined}
              onRecorded={handlePaymentRecorded}
            />
            <div className="flex items-center gap-2">
              <input
                id="close-after-payment"
                type="checkbox"
                className="size-4 accent-primary"
                checked={closeAfterPayment}
                onChange={(event) => setCloseAfterPayment(event.target.checked)}
                disabled={closeOrder.isPending}
              />
              <Label htmlFor="close-after-payment" className="text-sm font-normal">
                {t("orders.lifecycle.closeAfterPayment")}
              </Label>
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={closeOrder.isPending}>
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
            {closeOrder.isPending
              ? t("common.saving")
              : alreadyClosed
                ? t("orders.lifecycle.confirmAlreadyClosed")
                : t("orders.lifecycle.confirmClose")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
