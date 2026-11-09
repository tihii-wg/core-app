import type { Client, Order } from "../../lib/types";
import { useGetOrders } from "../orders/useGetOrders";
import ClientDetailPanel from "./ClientDetailPanel";
import { clientOrderSummaries } from "./clientOrders";

type ClientDetailsHostProps = {
  selectedClient: Client | null;
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
  onClientUpdated: (client: Client) => void;
  onClientDeleted?: (clientId: string) => void;
  onOpenOrder?: (order: Order) => void;
  onCreateOrder?: (client: Client) => void;
};

/** Wires the existing Client Details sheet to workspace orders. */
export function ClientDetailsHost({
  selectedClient,
  detailPanelOpen,
  setDetailPanelOpen,
  onClientUpdated,
  onClientDeleted,
  onOpenOrder,
  onCreateOrder,
}: ClientDetailsHostProps) {
  const { orders, isLoading, error } = useGetOrders("", { enabled: Boolean(selectedClient) && detailPanelOpen });

  return (
    <ClientDetailPanel
      selectedClient={selectedClient}
      detailPanelOpen={detailPanelOpen}
      setDetailPanelOpen={setDetailPanelOpen}
      onClientUpdated={onClientUpdated}
      onClientDeleted={onClientDeleted}
      getClientOrders={(clientId) => clientOrderSummaries(orders, clientId)}
      workspaceOrders={orders}
      ordersLoading={isLoading}
      ordersError={Boolean(error)}
      onOpenOrder={
        onOpenOrder
          ? (orderId) => {
              const order = orders.find((item) => item.id === orderId);
              if (order) onOpenOrder(order);
            }
          : undefined
      }
      onCreateOrder={onCreateOrder}
    />
  );
}
