import { useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import type { Order, OrderStatus } from "../../lib/types";
import { useUpdateOrderStatus } from "./useGetOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { isTaxInvoiceBlocked } from "./taxInvoice";

export function useOrderDetails() {
  const { t } = useTranslation();
  const { mutate: updateStatus, isPending: isStatusUpdating } = useUpdateOrderStatus();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const requireTaxInvoiceNumber = workspace?.requireTaxInvoiceNumber === true;
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const openOrder = (order: Order) => {
    setSelectedOrder(order);
    setDetailPanelOpen(true);
  };

  const syncOrder = (order: Order) => setSelectedOrder((current) => (current?.id === order.id ? order : current));

  const applyStatusLocally = (orderId: string, newStatus: OrderStatus) => {
    setSelectedOrder((current) =>
      current?.id === orderId
        ? { ...current, status: newStatus, ...(newStatus === "paid" ? { isPaid: true, paymentStatus: "paid" as const } : {}) }
        : current,
    );
  };

  const changeStatus = (order: Order, newStatus: OrderStatus) => {
    if (order.status === newStatus || isStatusUpdating) return;
    if (isTaxInvoiceBlocked(order, newStatus, requireTaxInvoiceNumber)) {
      // Keep the user in the order context so the number can be entered and saved first.
      toast.error(t("orders.taxInvoice.required"), { id: "tax-invoice-required" });
      openOrder(order);
      return;
    }
    updateStatus(
      { orderId: order.id, status: newStatus },
      {
        onSuccess: () => applyStatusLocally(order.id, newStatus),
      },
    );
  };

  const handleStatusChange = (newStatus: OrderStatus) => {
    if (!selectedOrder) return;
    changeStatus(selectedOrder, newStatus);
  };

  return {
    openOrder,
    syncOrder,
    changeStatus,
    isStatusUpdating,
    panelProps: {
      selectedOrder,
      detailPanelOpen,
      setDetailPanelOpen,
      onOrderUpdated: setSelectedOrder,
      onStatusChange: handleStatusChange,
      isStatusUpdating,
    },
  };
}
