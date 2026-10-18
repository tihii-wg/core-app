import { useState } from "react";
import type { Order, OrderStatus } from "../../lib/types";
import { useUpdateOrderStatus } from "./useGetOrders";

export function useOrderDetails() {
  const { mutate: updateStatus, isPending: isStatusUpdating } = useUpdateOrderStatus();
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
