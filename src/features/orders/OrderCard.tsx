import { useTranslation } from "react-i18next";
import type { Order, OrderStatus, PaymentStatus } from "../../lib/types";
import { OrderStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import { cn } from "../../lib/utils";
import { OrderActionsMenu } from "./OrderActionsMenu";

type OrderCardProps = {
  order: Order;
  invoiceNumber?: string;
  invoicesUnavailable?: boolean;
  isCreatingInvoice?: boolean;
  isStatusUpdating?: boolean;
  requireTaxInvoiceNumber?: boolean;
  /** Ledger-derived payment status when available; falls back to order.paymentStatus. */
  paymentStatus?: PaymentStatus;
  formatMoney: (value: number) => string;
  onView: (order: Order) => void;
  onEdit: (order: Order) => void;
  onStatusChange: (order: Order, status: OrderStatus) => void;
  onCreateInvoice: (order: Order) => void;
};

/**
 * Compact phone layout for one order (used below the md breakpoint instead of
 * the table). The whole surface opens the order; the actions menu stays an
 * independent control and never triggers the card click.
 */
export function OrderCard({
  order,
  invoiceNumber,
  invoicesUnavailable = false,
  isCreatingInvoice = false,
  isStatusUpdating = false,
  requireTaxInvoiceNumber = false,
  paymentStatus,
  formatMoney,
  onView,
  onEdit,
  onStatusChange,
  onCreateInvoice,
}: OrderCardProps) {
  const { t } = useTranslation();
  const registration = order.carNumber?.trim() || order.vin?.trim() || "";
  const resolvedPaymentStatus = paymentStatus ?? order.paymentStatus;

  return (
    <article
      onClick={() => onView(order)}
      className="cursor-pointer rounded-lg border border-border bg-card p-3 shadow-xs transition-colors hover:bg-accent/40 active:bg-accent/60"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-all font-semibold text-primary tabular-nums">{order.orderNumber}</p>
          <p className="mt-0.5 truncate font-medium text-foreground" title={order.clientName}>
            {order.clientName}
          </p>
        </div>
        <OrderActionsMenu
          order={order}
          invoiceNumber={invoiceNumber}
          invoicesUnavailable={invoicesUnavailable}
          isCreatingInvoice={isCreatingInvoice}
          isStatusUpdating={isStatusUpdating}
          requireTaxInvoiceNumber={requireTaxInvoiceNumber}
          onView={onView}
          onEdit={onEdit}
          onStatusChange={onStatusChange}
          onCreateInvoice={onCreateInvoice}
          triggerClassName="size-10 shrink-0"
        />
      </div>

      {(order.device || registration) && (
        <div className="mt-1.5 min-w-0 text-sm text-muted-foreground">
          {order.device ? (
            <p className="truncate" title={order.device}>
              {order.device}
            </p>
          ) : null}
          {registration ? (
            <p className="truncate text-xs tabular-nums" title={registration}>
              {registration}
            </p>
          ) : null}
        </div>
      )}

      <div className="mt-2.5 flex items-end gap-3 border-t border-border pt-2.5">
        <div className="flex min-w-0 flex-col items-start gap-1">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={resolvedPaymentStatus} />
        </div>
        <span className={cn("ml-auto shrink-0 text-right")}>
          <span className="block font-semibold tabular-nums text-foreground">{formatMoney(order.totalPrice)}</span>
          <span className="block text-[11px] tabular-nums text-muted-foreground">{order.createdAt || "—"}</span>
        </span>
      </div>
      <span className="sr-only">{t("orders.actions.viewDetails")}</span>
    </article>
  );
}
