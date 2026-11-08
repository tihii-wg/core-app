import { useEffect, useMemo, useRef, useState } from "react";
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
import { Spinner } from "../../ui/Spinner";
import type { Order } from "../../lib/types";
import { getOrder, type CloseOrderResult } from "../../services/apiOrders";
import type { LedgerPayment, PaymentBalance } from "../finance/paymentTypes";
import { orderPaymentBalance } from "../finance/paymentCalculations";
import { OrderPaymentForm } from "../finance/PaymentFormDialog";
import { paymentsQueryKey } from "../finance/usePayments";
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
  /** Called when a fresh order snapshot is loaded (so parents stop using a stale total). */
  onOrderRefreshed?: (order: Order) => void;
};

/** Match PaymentHistorySection: legacy paid-with-no-ledger still needs a first ledger row up to total. */
function recordableBalance(balance: PaymentBalance): PaymentBalance {
  return balance.isLegacyUnreconciled
    ? { ...balance, remaining: balance.total, netPaid: 0, status: "unpaid" }
    : balance;
}

/**
 * Explicit Close order confirmation. Always refetches the order + payments on open
 * so close/payment never settles against a cached totalPrice.
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
  onOrderRefreshed,
}: CloseOrderDialogProps) {
  const { t } = useTranslation();
  const closeOrder = useCloseOrder();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const [closeAfterPayment, setCloseAfterPayment] = useState(true);
  const [paymentsOverride, setPaymentsOverride] = useState<LedgerPayment[] | null>(null);
  const [freshOrder, setFreshOrder] = useState<Order | null>(null);
  const [loadingFresh, setLoadingFresh] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const seedOrderId = order?.id ?? null;

  // Parents often pass an inline callback; keep it out of the effect deps, otherwise every
  // parent re-render (including the one triggered by this callback) restarts the reload forever.
  const onOrderRefreshedRef = useRef(onOrderRefreshed);
  useEffect(() => {
    onOrderRefreshedRef.current = onOrderRefreshed;
  }, [onOrderRefreshed]);

  useEffect(() => {
    if (!open) {
      setPaymentsOverride(null);
      setCloseAfterPayment(true);
      setFreshOrder(null);
      setLoadingFresh(false);
      return;
    }
    if (!seedOrderId || !workspaceId) return;

    let cancelled = false;
    setLoadingFresh(true);
    setFreshOrder(null);
    setPaymentsOverride(null);

    void (async () => {
      try {
        // Only the fresh order + payments gate the dialog; list/dashboard caches refresh in the
        // background (awaiting them made the dialog wait for every orders query on the page).
        const [loaded] = await Promise.all([
          getOrder(seedOrderId, workspaceId),
          queryClient.refetchQueries({ queryKey: paymentsQueryKey(workspaceId), exact: true }),
        ]);
        void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
        if (cancelled) return;
        setFreshOrder(loaded);
        onOrderRefreshedRef.current?.(loaded);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        toast.error(message || t("common.somethingWentWrong"));
      } finally {
        if (!cancelled) setLoadingFresh(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, seedOrderId, workspaceId, reloadToken, queryClient, t]);

  const currentOrder = freshOrder ?? order;
  const effectivePayments = paymentsOverride ?? payments;

  // If the parent order snapshot changes after the initial fresh load (e.g. concurrent edit), reload.
  const loadedUpdatedAtRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      loadedUpdatedAtRef.current = null;
      return;
    }
    if (!freshOrder) return;
    if (loadedUpdatedAtRef.current == null) {
      loadedUpdatedAtRef.current = freshOrder.updatedAt || "";
      return;
    }
    const propUpdatedAt = order?.updatedAt || "";
    if (
      propUpdatedAt &&
      propUpdatedAt !== loadedUpdatedAtRef.current &&
      propUpdatedAt !== (freshOrder.updatedAt || "")
    ) {
      setReloadToken((token) => token + 1);
    }
  }, [open, order?.updatedAt, freshOrder]);

  const balance = useMemo(() => {
    if (!currentOrder) return null;
    return orderPaymentBalance(currentOrder, effectivePayments, invoiceId);
  }, [currentOrder, effectivePayments, invoiceId]);

  const recordable = balance ? recordableBalance(balance) : null;

  if (!order) return null;

  const displayOrder = currentOrder ?? order;
  const alreadyClosed = isOrderFormallyClosed(displayOrder);
  const displayRemaining = balance?.remaining ?? displayOrder.totalPrice;
  const recordableRemaining = recordable?.remaining ?? displayRemaining;
  const zeroTotal = (displayOrder.totalPrice ?? 0) <= 0.005;
  const totalsReady = Boolean(freshOrder) && !loadingFresh;
  // Match RPC: zero total may close without ledger; positive total needs ledger proof + remaining≈0.
  const canClose =
    totalsReady &&
    (alreadyClosed || (displayRemaining <= 0.005 && (zeroTotal || Boolean(balance?.hasLedger))));

  const blockedByOutstanding = totalsReady && !canClose && !alreadyClosed;
  const showPaymentForm =
    totalsReady && blockedByOutstanding && canRecordPayment && recordableRemaining > 0.005;

  async function handlePaymentRecorded(_amount: number) {
    if (!displayOrder || !freshOrder) return;
    const current = freshOrder;
    const listKey = paymentsQueryKey(workspaceId);

    let fresh: LedgerPayment[];
    try {
      await queryClient.refetchQueries({ queryKey: listKey, exact: true });
      const cached = queryClient.getQueryData<LedgerPayment[]>(listKey);
      fresh = Array.isArray(cached) ? cached : effectivePayments;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message || t("common.somethingWentWrong"));
      return;
    }

    setPaymentsOverride(fresh);

    const nextBalance = orderPaymentBalance(current, fresh, invoiceId);
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
      const result = await closeOrder.mutateAsync(current.id);
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
            {t("orders.lifecycle.closeDescription", { number: displayOrder.orderNumber })}
          </DialogDescription>
        </DialogHeader>

        {loadingFresh || !freshOrder ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            <span>{t("orders.lifecycle.loadingFreshTotals")}</span>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("orders.lifecycle.orderTotal")}</span>
              <span className="font-medium tabular-nums">{formatMoney(displayOrder.totalPrice)}</span>
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
            {alreadyClosed && displayOrder.closedAt ? (
              <p className="text-xs text-muted-foreground">
                {t("orders.lifecycle.closedAt", { date: displayOrder.closedAt })}
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
        )}

        {showPaymentForm && recordable ? (
          <div className="space-y-3 border-t border-border pt-3">
            <OrderPaymentForm
              key={`${displayOrder.id}:${recordableRemaining}:${displayOrder.totalPrice}`}
              orderId={displayOrder.id}
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
            disabled={!canClose || closeOrder.isPending || loadingFresh || !freshOrder}
            onClick={() => {
              if (!freshOrder) return;
              closeOrder.mutate(freshOrder.id, {
                onSuccess: (result) => {
                  onClosed?.(result);
                  onOpenChange(false);
                },
              });
            }}
          >
            {closeOrder.isPending
              ? t("common.saving")
              : loadingFresh || !freshOrder
                ? t("orders.lifecycle.loadingFreshTotals")
                : alreadyClosed
                  ? t("orders.lifecycle.confirmAlreadyClosed")
                  : t("orders.lifecycle.confirmClose")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
