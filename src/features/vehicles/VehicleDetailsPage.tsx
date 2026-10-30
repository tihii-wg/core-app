import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ClientDetailsHost } from "../clients/ClientDetailsHost";
import { useOpenClientDetails } from "../clients/useOpenClientDetails";
import OrderDetailPanel from "../orders/OrderDetailPanel";
import { useOrderDetails } from "../orders/useOrderDetails";
import { ordersListPath } from "./vehicleRoutes";
import { VehicleDetailPanel } from "./VehicleDetailPanel";

/**
 * Deep-link host for `/vehicles/:vehicleId`.
 * Opens Vehicle Details in the same Sheet drawer used elsewhere; closing returns to Orders.
 */
export function VehicleDetailsPage() {
  const navigate = useNavigate();
  const { locale = "en", workspaceId = "", vehicleId = "" } = useParams();
  const [open, setOpen] = useState(true);
  const clientDetails = useOpenClientDetails();
  const orderDetails = useOrderDetails();
  const ordersPath = ordersListPath(locale, workspaceId);

  useEffect(() => {
    setOpen(true);
  }, [vehicleId]);

  return (
    <>
      <VehicleDetailPanel
        vehicleId={vehicleId || null}
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            navigate(ordersPath, { replace: true });
          }
        }}
        onOpenClient={(clientId) => {
          void clientDetails.openClient(clientId);
        }}
        onOpenOrder={(order) => {
          clientDetails.setDetailPanelOpen(false);
          orderDetails.openOrder(order);
        }}
      />

      <ClientDetailsHost
        selectedClient={clientDetails.selectedClient}
        detailPanelOpen={clientDetails.detailPanelOpen}
        setDetailPanelOpen={clientDetails.setDetailPanelOpen}
        onClientUpdated={clientDetails.onClientUpdated}
        onOpenOrder={(order) => {
          clientDetails.setDetailPanelOpen(false);
          orderDetails.openOrder(order);
        }}
      />

      <OrderDetailPanel {...orderDetails.panelProps} />
    </>
  );
}
