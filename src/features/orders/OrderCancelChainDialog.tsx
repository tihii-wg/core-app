import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { Invoice, Order } from "../../lib/types";
import type { CancelOrderWithPaymentVoidResult } from "../../services/apiOrders";
import { useGetPayments } from "../finance/usePayments";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useIsWorkspaceOwnerId } from "../workspaces/useIsWorkspaceOwnerId";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { withSubscriptionWriteAccess } from "../workspaces/workspaceSubscription";
import { useGetStatusDefinitions } from "../statuses/useGetStatusDefinitions";
import {
  CancelOrderStepBody,
  type CancelOrderConfirmPayload,
  useCancelOrderHasActivePayments,
} from "./CancelOrderStepBody";
import { canOfferDeleteClosedOrderAction } from "./closedOrderPermissions";
import {
  applyCancelResultToOrder,
  nextCancelChainStep,
  remainingInvoiceNumbers,
  type OrderCancelChainAdvance,
  type OrderCancelChainInvoiceWork,
} from "./orderCancelChain";
import {
  activePaymentsBlockingOrderDelete,
  orderHasCancelSemantic,
} from "./orderDeletionEligibility";
import { useCancelOrder } from "./useCloseOrder";
import { useClosedOrderActionPermissions } from "./useClosedOrderPermissions";
import { useDeleteOrder } from "./useDeleteOrder";
import { useOrderCancelChainActions } from "./useOrderCancelChain";

type ChainStep =
  | { kind: "cancel" }
  | { kind: "annul"; invoice: Invoice; index: number; total: number }
  | { kind: "deleteInvoice"; invoice: Invoice; index: number; total: number }
  | { kind: "deleteOrder" }
  | { kind: "blocked"; reason: string };

type Progress = {
  cancelled: boolean;
  annulledNumbers: string[];
  deletedInvoiceNumbers: string[];
  remainingNumbers: string[];
};

type OrderCancelChainDialogProps = {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOrderUpdated?: (order: Order) => void;
  onDeleted?: (orderId: string) => void;
};

function stopBubble(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

type LooseT = (key: string, opts?: Record<string, unknown>) => string;

function summarizeStop(t: LooseT, progress: Progress): string {
  if (!progress.cancelled) return "";
  const remaining = progress.remainingNumbers;
  if (remaining.length > 0) {
    return t("orders.cancelChain.toast.cancelledWithInvoicesLeft", {
      numbers: remaining.join(", "),
    });
  }
  if (progress.deletedInvoiceNumbers.length > 0 || progress.annulledNumbers.length > 0) {
    return t("orders.cancelChain.toast.cancelledInvoicesCleared");
  }
  return t("orders.cancelChain.toast.cancelledOnly");
}

export function OrderCancelChainDialog({
  order,
  open,
  onOpenChange,
  onOrderUpdated,
  onDeleted,
}: OrderCancelChainDialogProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const cancelOrder = useCancelOrder();
  const deleteOrder = useDeleteOrder();
  const { refetchContext, annulInvoice, deleteInvoice } = useOrderCancelChainActions();
  const { payments } = useGetPayments();
  const { data: orderStatusDefinitions = [] } = useGetStatusDefinitions("order");
  const workspaceRole = useActiveWorkspaceRole();
  const isOwnerByOwnerId = useIsWorkspaceOwnerId();
  const { canWrite } = useWorkspaceSubscription();
  const closedOrderPerms = useClosedOrderActionPermissions();
  const canManageInvoices = withSubscriptionWriteAccess(Boolean(workspaceRole), canWrite);

  const [step, setStep] = useState<ChainStep>({ kind: "cancel" });
  const [workingOrder, setWorkingOrder] = useState<Order | null>(order);
  const [queue, setQueue] = useState<OrderCancelChainInvoiceWork[]>([]);
  const [nextIndex, setNextIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress>({
    cancelled: false,
    annulledNumbers: [],
    deletedInvoiceNumbers: [],
    remainingNumbers: [],
  });
  const [cancelPayload, setCancelPayload] = useState<CancelOrderConfirmPayload | null>(null);
  const [cancelValid, setCancelValid] = useState(true);

  const { hasActivePayments } = useCancelOrderHasActivePayments(workingOrder?.id);
  const voidPayments = cancelPayload?.voidPayments ?? true;

  const handlePayloadChange = useCallback((next: CancelOrderConfirmPayload | null) => {
    setCancelPayload(next);
  }, []);
  const handleValidityChange = useCallback((valid: boolean) => {
    setCancelValid(valid);
  }, []);

  useEffect(() => {
    if (!open) return;
    setWorkingOrder(order);
    setStep({ kind: "cancel" });
    setQueue([]);
    setNextIndex(0);
    setBusy(false);
    setProgress({
      cancelled: false,
      annulledNumbers: [],
      deletedInvoiceNumbers: [],
      remainingNumbers: [],
    });
    setCancelPayload(null);
    setCancelValid(true);
  }, [open, order?.id]);

  const requestBusy = busy || cancelOrder.isPending || deleteOrder.isPending;

  function computeDeleteBlockedReason(current: Order, invoices: readonly Invoice[]): string | null {
    if (!canWrite) return t("orders.cancelChain.blocked.subscriptionReadOnly");
    if (invoices.length > 0) return t("orders.errors.cannotDeleteWithInvoice");
    if (!orderHasCancelSemantic(current, orderStatusDefinitions)) {
      return t("orders.delete.requireCancelled");
    }
    if (activePaymentsBlockingOrderDelete(payments, current.id).length > 0) {
      return t("orders.errors.cannotDeleteWithActivePayments");
    }
    if (
      !canOfferDeleteClosedOrderAction({
        order: current,
        workspaceRole: closedOrderPerms.role,
        grants: closedOrderPerms.grants,
        isOwnerByOwnerId,
        ownerCanManageClosedOrders: closedOrderPerms.ownerCanManageClosedOrders,
      })
    ) {
      return t("orders.errors.deleteClosedForbidden");
    }
    return null;
  }

  function advanceFrom(
    current: Order,
    nextQueue: OrderCancelChainInvoiceWork[],
    index: number,
    preferDeleteForCurrent?: boolean,
  ) {
    const remainingInvoices = nextQueue.slice(index).map((item) => item.invoice);
    const advance = nextCancelChainStep({
      queue: nextQueue,
      nextIndex: index,
      preferDeleteForCurrent,
      capabilities: {
        canManageInvoices,
        deleteOrderBlockedReason: computeDeleteBlockedReason(current, remainingInvoices),
      },
      noInvoicePermissionReason: t("orders.cancelChain.blocked.noInvoicePermission"),
    });
    applyAdvance(advance, current, nextQueue, index);
  }

  function applyAdvance(
    advance: OrderCancelChainAdvance,
    current: Order,
    nextQueue: OrderCancelChainInvoiceWork[],
    index: number,
  ) {
    setQueue(nextQueue);
    setNextIndex(index);
    setWorkingOrder(current);

    if (advance.kind === "blocked") {
      toast(advance.reason, { id: "order-cancel-chain-blocked" });
      setStep({ kind: "blocked", reason: advance.reason });
      // Keep dialog briefly readable then close via explicit dismiss — show blocked as step.
      return;
    }
    if (advance.kind === "done") {
      finishClose(false);
      return;
    }
    if (advance.kind === "deleteOrder") {
      setStep({ kind: "deleteOrder" });
      return;
    }
    setStep(advance);
  }

  function finishClose(showSummary: boolean) {
    if (showSummary && progress.cancelled) {
      const message = summarizeStop(t as unknown as LooseT, progress);
      if (message) toast(message, { id: "order-cancel-chain-stop" });
    }
    onOpenChange(false);
  }

  function stopChain() {
    if (requestBusy) return;
    if (progress.cancelled) {
      const remaining =
        step.kind === "annul" || step.kind === "deleteInvoice"
          ? remainingInvoiceNumbers(
              queue.slice(nextIndex).map((item) => item.invoice),
            )
          : progress.remainingNumbers;
      const message = summarizeStop(t as unknown as LooseT, { ...progress, remainingNumbers: remaining });
      if (message) toast(message, { id: "order-cancel-chain-stop" });
    }
    onOpenChange(false);
  }

  async function handleCancelConfirm() {
    if (!workingOrder || !cancelPayload || !cancelValid || requestBusy) return;
    cancelOrder.mutate(cancelPayload, {
      onSuccess: (result: CancelOrderWithPaymentVoidResult) => {
        const updated = applyCancelResultToOrder(workingOrder, result);
        onOrderUpdated?.(updated);
        setProgress((prev) => ({ ...prev, cancelled: true }));
        void (async () => {
          setBusy(true);
          try {
            const ctx = await refetchContext(updated.id);
            const current = ctx.order.status === "cancelled" ? ctx.order : updated;
            setProgress((prev) => ({
              ...prev,
              remainingNumbers: remainingInvoiceNumbers(ctx.invoices),
            }));
            onOrderUpdated?.(current);
            advanceFrom(current, ctx.queue, 0);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
            finishClose(true);
          } finally {
            setBusy(false);
          }
        })();
      },
    });
  }

  async function handleAnnulConfirm() {
    if (step.kind !== "annul" || requestBusy) return;
    const invoice = step.invoice;
    const { index, total } = step;
    setBusy(true);
    try {
      const updatedInvoice = await annulInvoice(invoice.id);
      setProgress((prev) => ({
        ...prev,
        annulledNumbers: [...prev.annulledNumbers, invoice.invoiceNumber],
      }));
      if (workingOrder) {
        const ctx = await refetchContext(workingOrder.id);
        onOrderUpdated?.(ctx.order);
        setWorkingOrder(ctx.order);
        setProgress((prev) => ({
          ...prev,
          remainingNumbers: remainingInvoiceNumbers(ctx.invoices),
        }));
      }
      // Stay on the same invoice for delete — do not rebuild queue mid-invoice
      // (annul moves the row into the erroneous bucket and would reshuffle indices).
      setStep({
        kind: "deleteInvoice",
        invoice: { ...invoice, ...updatedInvoice, status: "erroneous" },
        index,
        total,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteInvoiceConfirm() {
    if (step.kind !== "deleteInvoice" || requestBusy) return;
    const invoice = step.invoice;
    setBusy(true);
    try {
      await deleteInvoice(invoice.id);
      setProgress((prev) => ({
        ...prev,
        deletedInvoiceNumbers: [...prev.deletedInvoiceNumbers, invoice.invoiceNumber],
      }));
      if (!workingOrder) return;
      const ctx = await refetchContext(workingOrder.id);
      const current = ctx.order;
      onOrderUpdated?.(current);
      setProgress((prev) => ({
        ...prev,
        remainingNumbers: remainingInvoiceNumbers(ctx.invoices),
      }));
      // After delete, continue from the start of remaining queue (refetched).
      advanceFrom(current, ctx.queue, 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteOrderConfirm() {
    if (!workingOrder || requestBusy) return;
    setBusy(true);
    try {
      // Fresh check before delete.
      const ctx = await refetchContext(workingOrder.id);
      const blocked = computeDeleteBlockedReason(ctx.order, ctx.invoices);
      if (blocked) {
        toast(blocked, { id: "order-cancel-chain-blocked" });
        setStep({ kind: "blocked", reason: blocked });
        return;
      }
      await deleteOrder.mutateAsync(workingOrder.id);
      onDeleted?.(workingOrder.id);
      onOpenChange(false);
    } catch {
      // useDeleteOrder already toasts
    } finally {
      setBusy(false);
    }
  }

  const title = useMemo(() => {
    switch (step.kind) {
      case "cancel":
        return t("orders.lifecycle.cancelTitle");
      case "annul":
        return t("orders.cancelChain.annulTitle", { index: step.index, total: step.total });
      case "deleteInvoice":
        return t("orders.cancelChain.deleteInvoiceTitle", { index: step.index, total: step.total });
      case "deleteOrder":
        return t("orders.delete.title");
      case "blocked":
        return t("orders.cancelChain.blockedTitle");
      default:
        return "";
    }
  }, [step, t]);

  const description = useMemo(() => {
    if (!workingOrder) return "";
    switch (step.kind) {
      case "cancel":
        return t("orders.lifecycle.cancelDescription", { number: workingOrder.orderNumber });
      case "annul":
        return t("orders.cancelChain.annulDescription", {
          number: step.invoice.invoiceNumber,
          amount: formatMoney(step.invoice.total ?? step.invoice.amount ?? 0),
        });
      case "deleteInvoice":
        return t("orders.cancelChain.deleteInvoiceDescription", {
          number: step.invoice.invoiceNumber,
        });
      case "deleteOrder":
        return t("orders.delete.descriptionCancelledWithStock", {
          number: workingOrder.orderNumber,
        });
      case "blocked":
        return step.reason;
      default:
        return "";
    }
  }, [formatMoney, step, t, workingOrder]);

  const secondaryLabel =
    step.kind === "cancel"
      ? t("orders.cancelChain.doNotCancel")
      : step.kind === "blocked"
        ? t("common.close")
        : t("orders.cancelChain.notNow");

  return (
    <Dialog
      open={open && Boolean(workingOrder)}
      onOpenChange={(next) => {
        if (requestBusy) return;
        if (!next) stopChain();
        else onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md" onClick={stopBubble} onPointerDown={stopBubble}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {step.kind === "cancel" && workingOrder ? (
          <CancelOrderStepBody
            order={workingOrder}
            open={open && step.kind === "cancel"}
            busy={requestBusy}
            idPrefix="cancel-chain"
            onValidityChange={handleValidityChange}
            onPayloadChange={handlePayloadChange}
          />
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={requestBusy}
            onClick={stopChain}
          >
            {secondaryLabel}
          </Button>

          {step.kind === "cancel" ? (
            <Button
              type="button"
              variant="destructive"
              className="w-full sm:w-auto"
              disabled={requestBusy || !cancelValid || !cancelPayload}
              onClick={handleCancelConfirm}
            >
              {cancelOrder.isPending || busy
                ? t("common.saving")
                : hasActivePayments && voidPayments
                  ? t("orders.cancelFinance.confirmWithVoid")
                  : t("orders.lifecycle.confirmCancel")}
            </Button>
          ) : null}

          {step.kind === "annul" ? (
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={requestBusy}
              onClick={() => void handleAnnulConfirm()}
            >
              {busy ? t("common.saving") : t("orders.cancelChain.annulConfirm")}
            </Button>
          ) : null}

          {step.kind === "deleteInvoice" ? (
            <Button
              type="button"
              variant="destructive"
              className="w-full sm:w-auto"
              disabled={requestBusy}
              onClick={() => void handleDeleteInvoiceConfirm()}
            >
              {busy ? t("common.deleting") : t("orders.cancelChain.deleteInvoiceConfirm")}
            </Button>
          ) : null}

          {step.kind === "deleteOrder" ? (
            <Button
              type="button"
              variant="destructive"
              className="w-full sm:w-auto"
              disabled={requestBusy}
              onClick={() => void handleDeleteOrderConfirm()}
            >
              {busy || deleteOrder.isPending ? t("common.deleting") : t("orders.actions.delete")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
