import { useTranslation } from "react-i18next";
import type { Order, PaymentStatus } from "../../lib/types";
import { cn } from "../../lib/utils";
import { PaymentStatusBadge } from "../../ui/StatusBadge";
import { effectiveOrderVatRate, orderVatBreakdown } from "../finance/orderVat";
import { OrderTotalBreakdownPopover } from "./OrderTotalBreakdownPopover";
import { OrderVatBreakdownView } from "./OrderVatBreakdown";

type OrderDetailHeaderTotalProps = {
  order: Order;
  formatMoney: (value: number) => string;
  paymentStatus: PaymentStatus;
  workspaceVatRate: number | null | undefined;
  worksLabel: string;
  materialsLabel: string;
  className?: string;
};

/**
 * Compact order total for the card SheetHeader: large amount, optional one-line VAT,
 * paid/unpaid badge. Breakdown popover on hover/tap (same as the old info-tab block).
 */
export function OrderDetailHeaderTotal({
  order,
  formatMoney,
  paymentStatus,
  workspaceVatRate,
  worksLabel,
  materialsLabel,
  className,
}: OrderDetailHeaderTotalProps) {
  const { t } = useTranslation();
  const vatRate = effectiveOrderVatRate(order, workspaceVatRate);
  const vat = orderVatBreakdown({ total: order.totalPrice, vatRate });

  return (
    <div
      className={cn(
        "flex min-w-0 items-end justify-between gap-3 sm:flex-col sm:items-end sm:justify-start sm:gap-1",
        className,
      )}
      data-testid="order-detail-header-total"
    >
      <div className="min-w-0 text-left sm:text-right [overflow-wrap:anywhere]">
        <p className="text-lg font-semibold tracking-tight text-foreground tabular-nums sm:text-xl">
          <OrderTotalBreakdownPopover
            order={order}
            formatMoney={formatMoney}
            worksLabel={worksLabel}
            materialsLabel={materialsLabel}
          >
            {formatMoney(order.totalPrice ?? 0)}
          </OrderTotalBreakdownPopover>
        </p>
        <OrderVatBreakdownView
          compact
          className="mt-0.5 text-[11px] text-muted-foreground"
          breakdown={vat}
          formatMoney={formatMoney}
          showNoRateHint={false}
          testId="order-header-vat"
        />
        {(order.discountTotal ?? 0) > 0 ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums" data-testid="order-header-discount">
            {t("orders.detail.discount")}: −{formatMoney(order.discountTotal ?? 0)}
          </p>
        ) : null}
      </div>
      <div className="shrink-0 self-center sm:self-end">
        <PaymentStatusBadge status={paymentStatus} />
      </div>
    </div>
  );
}
