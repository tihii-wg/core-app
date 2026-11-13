import type { TFunction } from "i18next";
import type { Order } from "../../../lib/types";
import { activePaymentsBlockingOrderDelete, orderHasCancelSemantic } from "../orderDeletionEligibility";
import {
  canOfferCancelOrderAction,
  canOfferDeleteClosedOrderAction,
} from "../closedOrderPermissions";
import { isEstimateOrder } from "../orderEstimates";
import { isOrderFormallyClosed } from "../orderLifecycle";

export function computeOrderDetailLifecycleFlags(args: {
  selectedOrder: Order | null;
  invoiceNumber?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payments: readonly any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orderStatusDefinitions: any[];
  canEditOrder: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workspaceRole: any;
  closedOrderPerms: {
    grants: Parameters<typeof canOfferDeleteClosedOrderAction>[0]["grants"];
    ownerCanManageClosedOrders: boolean;
  };
  isOwnerByOwnerId: boolean;
  t: TFunction;
}) {
  const {
    selectedOrder,
    invoiceNumber,
    payments,
    orderStatusDefinitions,
    canEditOrder,
    workspaceRole,
    closedOrderPerms,
    isOwnerByOwnerId,
    t,
  } = args;

  const estimate = isEstimateOrder(selectedOrder);
  const hasInvoice = Boolean(invoiceNumber);
  const isCancelledForDelete = selectedOrder
    ? estimate
      ? true
      : orderHasCancelSemantic(selectedOrder, orderStatusDefinitions)
    : false;
  const activePaymentsBlockingDelete = selectedOrder
    ? activePaymentsBlockingOrderDelete(payments, selectedOrder.id)
    : [];
  const deleteBlockedReason = !selectedOrder
    ? null
    : hasInvoice
      ? t("orders.errors.cannotDeleteWithInvoice")
      : !isCancelledForDelete
        ? t("orders.delete.requireCancelled")
        : activePaymentsBlockingDelete.length > 0
          ? t("orders.errors.cannotDeleteWithActivePayments")
          : !estimate &&
              !canOfferDeleteClosedOrderAction({
                order: selectedOrder,
                workspaceRole,
                grants: closedOrderPerms.grants,
                isOwnerByOwnerId,
                ownerCanManageClosedOrders: closedOrderPerms.ownerCanManageClosedOrders,
              })
            ? t("orders.errors.deleteClosedForbidden")
            : null;
  const showOpenLifecycleActions =
    !estimate &&
    canEditOrder &&
    selectedOrder != null &&
    !isOrderFormallyClosed(selectedOrder) &&
    selectedOrder.status !== "cancelled";
  const showCancelClosedAction =
    !estimate &&
    selectedOrder != null &&
    canOfferCancelOrderAction({
      order: selectedOrder,
      canWrite: canEditOrder,
      workspaceRole,
      grants: closedOrderPerms.grants,
      isOwnerByOwnerId,
      ownerCanManageClosedOrders: closedOrderPerms.ownerCanManageClosedOrders,
    }) &&
    isOrderFormallyClosed(selectedOrder);
  const linkedPaymentCount = selectedOrder
    ? payments.filter((payment) => payment.orderId === selectedOrder.id).length
    : 0;

  return {
    hasInvoice,
    isCancelledForDelete,
    deleteBlockedReason,
    showOpenLifecycleActions,
    showCancelClosedAction,
    linkedPaymentCount,
  };
}
