import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Order } from "../../lib/types";
import { Skeleton } from "../../ui/Skeleton";
import { ClientDetailsHost } from "../clients/ClientDetailsHost";
import { useOpenClientDetails } from "../clients/useOpenClientDetails";
import { useGetVehicle } from "../vehicles/useGetVehicle";
import { VehicleDetailPanel } from "../vehicles/VehicleDetailPanel";
import { VehicleFieldsGrid } from "./VehicleFieldsGrid";

export { VehicleFieldsGrid };

type OrderLinkedVehicleDetailsProps = {
  vehicleId: string | null | undefined;
  /** Switch the host Order Details panel to a related order (avoids nesting another Order Details sheet). */
  onOpenRelatedOrder: (order: Order) => void;
};

/** Read-only vehicle fields from `vehicles` via `orders.vehicle_id`. Never mutates the vehicle. */
export function OrderLinkedVehicleDetails({ vehicleId, onOpenRelatedOrder }: OrderLinkedVehicleDetailsProps) {
  const { t } = useTranslation();
  const empty = t("common.noValue");
  const id = vehicleId?.trim() || "";
  const { vehicle, isLoading, isError, notFound } = useGetVehicle(id || null);
  const [detailOpen, setDetailOpen] = useState(false);
  const clientDetails = useOpenClientDetails();

  if (!id) return null;

  return (
    <section className="space-y-3" data-testid="order-linked-vehicle">
      <h3 className="text-sm font-medium text-foreground">{t("vehicles.orderDetailsTitle")}</h3>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive" role="alert">
          {t("vehicles.loadFailed")}
        </p>
      ) : notFound || !vehicle ? (
        <p className="text-sm text-destructive" role="alert">
          {t("vehicles.errors.notFound")}
        </p>
      ) : (
        <>
          <VehicleFieldsGrid vehicle={vehicle} empty={empty} />
          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="inline-flex text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
          >
            {t("vehicles.details.view")}
          </button>
        </>
      )}

      <VehicleDetailPanel
        vehicleId={detailOpen ? id : null}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onOpenClient={(clientId) => {
          void clientDetails.openClient(clientId, null);
        }}
        onOpenOrder={(order) => {
          setDetailOpen(false);
          onOpenRelatedOrder(order);
        }}
      />

      {clientDetails.detailPanelOpen || clientDetails.selectedClient ? (
        <ClientDetailsHost
          selectedClient={clientDetails.selectedClient}
          detailPanelOpen={clientDetails.detailPanelOpen}
          setDetailPanelOpen={clientDetails.setDetailPanelOpen}
          onClientUpdated={clientDetails.onClientUpdated}
          onOpenOrder={(order) => {
            clientDetails.setDetailPanelOpen(false);
            setDetailOpen(false);
            onOpenRelatedOrder(order);
          }}
        />
      ) : null}
    </section>
  );
}
