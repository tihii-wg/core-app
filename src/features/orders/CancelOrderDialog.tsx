import { useCallback, useState } from "react";
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
import type { CancelOrderWithPaymentVoidResult } from "../../services/apiOrders";
import { useCancelOrder } from "./useCloseOrder";
import {
  CancelOrderStepBody,
  type CancelOrderConfirmPayload,
  useCancelOrderHasActivePayments,
} from "./CancelOrderStepBody";

type CancelOrderDialogProps = {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancelled?: (result: CancelOrderWithPaymentVoidResult) => void;
};

function stopBubble(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

export function CancelOrderDialog({ order, open, onOpenChange, onCancelled }: CancelOrderDialogProps) {
  const { t } = useTranslation();
  const cancelOrder = useCancelOrder();
  const [payload, setPayload] = useState<CancelOrderConfirmPayload | null>(null);
  const [confirmValid, setConfirmValid] = useState(true);
  const { hasActivePayments } = useCancelOrderHasActivePayments(order?.id);
  const voidPayments = payload?.voidPayments ?? true;

  const handlePayloadChange = useCallback((next: CancelOrderConfirmPayload | null) => {
    setPayload(next);
  }, []);

  const handleValidityChange = useCallback((valid: boolean) => {
    setConfirmValid(valid);
  }, []);

  const confirmDisabled = cancelOrder.isPending || !confirmValid || !payload;

  function handleConfirm() {
    if (!order || !payload || confirmDisabled) return;
    cancelOrder.mutate(payload, {
      onSuccess: (result) => {
        onOpenChange(false);
        onCancelled?.(result);
      },
    });
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
            {t("orders.lifecycle.cancelDescription", { number: order?.orderNumber ?? "" })}
          </DialogDescription>
        </DialogHeader>

        {order ? (
          <CancelOrderStepBody
            order={order}
            open={open}
            busy={cancelOrder.isPending}
            onValidityChange={handleValidityChange}
            onPayloadChange={handlePayloadChange}
          />
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
            disabled={cancelOrder.isPending}
          >
            {t("orders.cancelChain.doNotCancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="w-full sm:w-auto"
            disabled={confirmDisabled}
            onClick={handleConfirm}
          >
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
