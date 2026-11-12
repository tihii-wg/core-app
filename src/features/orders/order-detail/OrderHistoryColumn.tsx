import { memo } from "react";
import { cn } from "../../../lib/utils";
import OrderFeedSection from "../OrderFeedSection";

export type OrderHistoryColumnProps = {
  orderId: string;
  orderNumber: string;
  enabled: boolean;
  canComment: boolean;
  isDesktopFeedLayout: boolean;
  showFeedColumn: boolean;
};

/**
 * Right-hand activity feed + comment box. Only depends on order identity / comment rights —
 * must not re-render when line edit state changes.
 */
function OrderHistoryColumnComponent({
  orderId,
  orderNumber,
  enabled,
  canComment,
  isDesktopFeedLayout,
  showFeedColumn,
}: OrderHistoryColumnProps) {
  return (
    <div
      className={cn(
        "min-h-0 min-w-0",
        isDesktopFeedLayout
          ? "flex w-[min(100%,380px)] shrink-0 flex-col border-l border-border bg-muted/20"
          : showFeedColumn
            ? "flex min-h-0 flex-1 flex-col bg-muted/20"
            : "hidden",
      )}
      data-testid="order-detail-feed-column"
      aria-hidden={!showFeedColumn}
    >
      <OrderFeedSection
        orderId={orderId}
        orderNumber={orderNumber}
        enabled={enabled}
        canComment={canComment}
        layout="panel"
      />
    </div>
  );
}

export const OrderHistoryColumn = memo(OrderHistoryColumnComponent);
