import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { Order } from "../../../lib/types";
import { Label } from "../../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../ui/Select";
import { OrderStatusBadge } from "../../../ui/StatusBadge";
import { isOrderCurrentlyClosed } from "../orderLifecycle";
import type { OrderStatusChangeOption } from "../useOrderStatusChange";

export type OrderDetailStatusBarProps = {
  selectedOrder: Order;
  lifecycleStatusLocked: boolean;
  paidStatusLocked: boolean;
  paidStatusBlocked: boolean;
  canEditOrder: boolean;
  isStatusUpdating: boolean;
  isUnifiedStatusUpdating: boolean;
  isAssigneeUpdating: boolean;
  currentUnifiedStatusId: string | undefined;
  statusOptions: OrderStatusChangeOption[];
  paymentRemaining: number | null;
  formatMoney: (value: number) => string;
  onStatusSelect: (value: string) => void;
};

function OrderDetailStatusBarComponent({
  selectedOrder,
  lifecycleStatusLocked,
  paidStatusLocked,
  paidStatusBlocked,
  canEditOrder,
  isStatusUpdating,
  isUnifiedStatusUpdating,
  isAssigneeUpdating,
  currentUnifiedStatusId,
  statusOptions,
  paymentRemaining,
  formatMoney,
  onStatusSelect,
}: OrderDetailStatusBarProps) {
  const { t } = useTranslation();

  return (
    <div
      className="max-h-40 shrink-0 overflow-y-auto border-b border-border px-5 py-2"
      data-testid="order-detail-status-bar"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Label htmlFor="order-status" className="sr-only">
          {lifecycleStatusLocked || paidStatusLocked
            ? t("orders.actions.statusLocked")
            : t("orders.detail.updateStatus")}
        </Label>
        {lifecycleStatusLocked ? (
          <div id="order-status" className="flex min-w-0 items-center gap-2">
            <OrderStatusBadge status={selectedOrder.status} customStatus={selectedOrder.customStatus} />
            <span className="text-xs text-muted-foreground">
              {selectedOrder.status === "cancelled"
                ? t("orders.lifecycle.errors.orderAlreadyCancelled")
                : t("orders.lifecycle.errors.closedOrderImmutable")}
            </span>
          </div>
        ) : (
          <Select
            value={currentUnifiedStatusId ?? statusOptions[0]?.id ?? ""}
            onValueChange={onStatusSelect}
            disabled={
              !canEditOrder ||
              isStatusUpdating ||
              isUnifiedStatusUpdating ||
              isAssigneeUpdating ||
              paidStatusLocked
            }
          >
            <SelectTrigger id="order-status" className="min-w-0 flex-1 basis-48 sm:max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem
                  key={option.id}
                  value={option.id}
                  disabled={option.disabled}
                  title={option.disabledReason ?? undefined}
                >
                  <span className="inline-flex min-w-0 items-center gap-2">
                    {option.color ? (
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-border"
                        style={{ backgroundColor: option.color }}
                      />
                    ) : null}
                    <span className="min-w-0 [overflow-wrap:anywhere]">{option.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {isOrderCurrentlyClosed(selectedOrder) ? (
        <div
          className="mt-2 space-y-0.5 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm"
          data-closed-order-banner
        >
          <p className="font-medium text-foreground">{t("orders.lifecycle.closedBadge")}</p>
          <p className="text-xs text-muted-foreground">
            {t("orders.lifecycle.closedAt", { date: selectedOrder.closedAt })}
          </p>
          <p
            className="text-xs text-muted-foreground"
            data-closed-order-immutable-hint
            data-testid="closed-order-immutable-hint"
          >
            {t("orders.lifecycle.errors.closedOrderImmutable")}
          </p>
          {paymentRemaining != null && paymentRemaining > 0.005 ? (
            <p className="text-sm text-destructive">
              {t("orders.lifecycle.postCloseOutstanding", { amount: formatMoney(paymentRemaining) })}
            </p>
          ) : null}
        </div>
      ) : null}
      {paidStatusLocked ? (
        <p className="mt-1.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {t("orders.actions.paidStatusImmutable")}
        </p>
      ) : paidStatusBlocked ? (
        <p className="mt-1.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {t("orders.taxInvoice.paidRequiresNumber")}
        </p>
      ) : null}
    </div>
  );
}

export const OrderDetailStatusBar = memo(OrderDetailStatusBarComponent);
