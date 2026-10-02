import { useState } from "react";
import type { Order, OrderStatus } from "../../lib/types";
import { useUpdateOrderStatus } from "./useGetOrders";

export function useOrderDetails() {
  const { mutate: updateStatus } = useUpdateOrderStatus();
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const openOrder = (order: Order) => {
    setSelectedOrder(order);
    setDetailPanelOpen(true);
  };

  const syncOrder = (order: Order) => setSelectedOrder((current) => (current?.id === order.id ? order : current));

  const handleStatusChange = (newStatus: OrderStatus) => {
    if (!selectedOrder) return;
    const order = selectedOrder;
    updateStatus(
      { orderId: order.id, status: newStatus },
      {
        onSuccess: () =>
          setSelectedOrder((current) =>
            current?.id === order.id
              ? { ...current, status: newStatus, ...(newStatus === "paid" ? { isPaid: true, paymentStatus: "paid" as const } : {}) }
              : current,
          ),
      },
    );
  };

  return {
    openOrder,
    syncOrder,
    panelProps: {
      selectedOrder,
      detailPanelOpen,
      setDetailPanelOpen,
      onOrderUpdated: setSelectedOrder,
      onStatusChange: handleStatusChange,
    },
  };
}
