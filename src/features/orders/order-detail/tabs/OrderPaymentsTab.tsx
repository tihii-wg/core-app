import { memo } from "react";
import type { Order } from "../../../../lib/types";
import type { LedgerPayment } from "../../../finance/paymentTypes";
import { PaymentHistorySection } from "../../../finance/PaymentHistorySection";
import { OrderPaymentStagesSection } from "../../../finance/OrderPaymentStagesSection";

export type OrderPaymentsTabProps = {
  order: Order;
  payments: LedgerPayment[];
  paymentsLoading: boolean;
  canEdit: boolean;
  onOrderUpdated: (order: Order) => void;
  onBeforeRecord: () => Promise<boolean>;
};

function OrderPaymentsTabComponent({
  order,
  payments,
  paymentsLoading,
  canEdit,
  onOrderUpdated,
  onBeforeRecord,
}: OrderPaymentsTabProps) {
  return (
    <>
      <PaymentHistorySection
        target="order"
        order={order}
        fullOrder={order}
        onOrderUpdated={onOrderUpdated}
        payments={payments}
        isLoading={paymentsLoading}
        canRecord={canEdit}
        onBeforeRecord={onBeforeRecord}
      />

      <OrderPaymentStagesSection
        order={order}
        payments={payments}
        canEdit={canEdit}
        onOrderUpdated={onOrderUpdated}
        onBeforeRecord={onBeforeRecord}
      />
    </>
  );
}

export const OrderPaymentsTab = memo(OrderPaymentsTabComponent);
