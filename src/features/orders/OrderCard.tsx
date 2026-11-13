import { useTranslation } from "react-i18next";
import { isRowClickIgnored } from "../../ui/DataTable";
import { OrderTotalBreakdownPopover } from "./OrderTotalBreakdownPopover";
import type { Order, OrderStatus, PaymentStatus } from "../../lib/types";
import { EntityStatusBadge, OrderStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import { cn } from "../../lib/utils";
import { OrderActionsMenu } from "./OrderActionsMenu";
import { OrderClientName } from "./OrderClientName";
import { isEstimateOrder } from "./orderEstimates";
import { OrderWarrantyIndicator } from "./OrderWarrantyIndicator";
import { OrderEstimateMark } from "./OrderEstimateMark";
import OrderTeamAvatars from "./OrderTeamAvatars";
import type { OrderWarrantyIndicatorModel } from "./warranty";
import { industryProfile } from "../industries/industryProfile";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { orderAssetSecondaryLine } from "./industryOrderFieldHelpers";

type OrderCardProps = {
  order: Order;
  invoiceNumber?: string;
  linkedPaymentCount?: number;
  invoicesUnavailable?: boolean;
  isCreatingInvoice?: boolean;
  isStatusUpdating?: boolean;
  requireTaxInvoiceNumber?: boolean;
  /** Ledger-derived payment status when available; falls back to order.paymentStatus. */
  paymentStatus?: PaymentStatus;
  hidePayments?: boolean;
  /** Batched warranty indicator for this card (from useOrdersWarrantyIndicators). */
  warrantyIndicator?: OrderWarrantyIndicatorModel | null;
  formatMoney: (value: number) => string;
  onView: (order: Order) => void;
  onOpenClient?: (clientId: string) => void;
  onEdit: (order: Order) => void;
  onStatusChange: (order: Order, status: OrderStatus) => void;
  onCreateInvoice: (order: Order) => void;
  onOrderUpdated?: (order: Order) => void;
  onDeleted?: (orderId: string) => void;
};

/**
 * Compact phone layout for one order (used below the md breakpoint instead of
 * the table). The whole surface opens the order; the actions menu stays an
 * independent control and never triggers the card click.
 */
export function OrderCard({
  order,
  invoiceNumber,
  linkedPaymentCount = 0,
  invoicesUnavailable = false,
  isCreatingInvoice = false,
  isStatusUpdating = false,
  requireTaxInvoiceNumber = false,
  paymentStatus,
  hidePayments = false,
  warrantyIndicator,
  formatMoney,
  onView,
  onOpenClient,
  onEdit,
  onStatusChange,
  onCreateInvoice,
  onOrderUpdated,
  onDeleted,
}: OrderCardProps) {
  const { t } = useTranslation();
  const { profile, industrySlug } = useIndustryWorkflow();
  const blocks = profile?.orderFieldBlocks ?? industryProfile(industrySlug).orderFieldBlocks;
  const secondary = orderAssetSecondaryLine(order, blocks);
  const resolvedPaymentStatus = paymentStatus ?? order.paymentStatus;

  return (
    <article
      onClick={(event) => {
        if (isRowClickIgnored(event.target)) return;
        onView(order);
      }}
      className="cursor-pointer rounded-lg border border-border bg-card p-3 shadow-xs transition-colors hover:bg-accent/40 active:bg-accent/60"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-all font-semibold text-primary tabular-nums">{order.orderNumber}</p>
          <OrderEstimateMark order={order} className="mt-0.5" />
          <OrderWarrantyIndicator model={warrantyIndicator} className="mt-0.5" />
          <p className="mt-0.5 truncate font-medium text-foreground">
            {onOpenClient ? (
              <OrderClientName clientId={order.clientId} clientName={order.clientName} onOpenClient={onOpenClient} />
            ) : (
              <span title={order.clientName}>{order.clientName}</span>
            )}
          </p>
        </div>
        <OrderActionsMenu
          order={order}
          invoiceNumber={invoiceNumber}
          linkedPaymentCount={linkedPaymentCount}
          invoicesUnavailable={invoicesUnavailable}
          isCreatingInvoice={isCreatingInvoice}
          isStatusUpdating={isStatusUpdating}
          requireTaxInvoiceNumber={requireTaxInvoiceNumber}
          onView={onView}
          onEdit={onEdit}
          onStatusChange={onStatusChange}
          onCreateInvoice={onCreateInvoice}
          onOrderUpdated={onOrderUpdated}
          onDeleted={onDeleted}
          triggerClassName="size-10 shrink-0"
        />
      </div>

      {(order.device || secondary) && (
        <div className="mt-1.5 min-w-0 text-sm text-muted-foreground">
          {order.device ? (
            <p className="truncate" title={order.device}>
              {order.device}
            </p>
          ) : null}
          {secondary ? (
            <p className="truncate text-xs tabular-nums" title={secondary}>
              {secondary}
            </p>
          ) : null}
        </div>
      )}

      <div className="mt-2.5 flex min-w-0 items-end gap-3 overflow-hidden border-t border-border pt-2.5">
        <div className="flex min-w-0 max-w-full flex-1 flex-col items-stretch gap-1">
          {hidePayments || isEstimateOrder(order) ? (
            order.estimateStatus ? (
              <EntityStatusBadge name={order.estimateStatus.name} color={order.estimateStatus.color} />
            ) : null
          ) : (
            <>
              <OrderStatusBadge status={order.status} customStatus={order.customStatus} />
              <PaymentStatusBadge status={resolvedPaymentStatus} />
            </>
          )}
          {order.team && order.team.length > 0 ? <OrderTeamAvatars team={order.team} /> : null}
        </div>
        <span className={cn("shrink-0 text-right")}>
          <OrderTotalBreakdownPopover order={order} formatMoney={formatMoney} className="block">
            <span className="block font-semibold tabular-nums text-foreground">{formatMoney(order.totalPrice)}</span>
          </OrderTotalBreakdownPopover>
          <span className="block text-[11px] tabular-nums text-muted-foreground">{order.createdAt || "—"}</span>
        </span>
      </div>
      <span className="sr-only">{t("orders.actions.viewDetails")}</span>
    </article>
  );
}
