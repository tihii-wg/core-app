import { memo } from "react";
import OrderAttachmentsSection from "../../OrderAttachmentsSection";

export type OrderFilesTabProps = {
  orderId: string;
  enabled: boolean;
  closedContentLocked: boolean;
};

function OrderFilesTabComponent({ orderId, enabled, closedContentLocked }: OrderFilesTabProps) {
  return (
    <OrderAttachmentsSection
      orderId={orderId}
      enabled={enabled}
      canMutateOverride={closedContentLocked ? false : undefined}
    />
  );
}

export const OrderFilesTab = memo(OrderFilesTabComponent);
