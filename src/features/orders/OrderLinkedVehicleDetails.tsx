import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MileageUnit, Order } from "../../lib/types";
import { Skeleton } from "../../ui/Skeleton";
import { ClientDetailsHost } from "../clients/ClientDetailsHost";
import { useOpenClientDetails } from "../clients/useOpenClientDetails";
import { useGetVehicle } from "../vehicles/useGetVehicle";
import { VehicleDetailPanel } from "../vehicles/VehicleDetailPanel";
import type { OrderFieldConfigItem } from "./orderFieldConfig";
import { VehicleFieldsGrid, type VehicleGridRow } from "./VehicleFieldsGrid";

export { VehicleFieldsGrid };

type OrderLinkedVehicleDetailsProps = {
  vehicleId: string | null | undefined;
  /** Historical visit mileage from the order — never the vehicle's live unit/reading. */
  vehicleMileageSnapshot?: number | null;
  vehicleMileageUnitSnapshot?: MileageUnit | null;
  /** Switch the host Order Details panel to a related order (avoids nesting another Order Details sheet). */
  onOpenRelatedOrder: (order: Order) => void;
  /**
   * Replace a grid row with custom content (e.g. inline-editable visit mileage). Return `undefined` for the default row.
   * Every other value is read-only here: clicking it opens the vehicle card.
   */
  renderRow?: (row: VehicleGridRow, vehicleId: string) => ReactNode | undefined;
  /** Order field config for labels / visibility / order (order context only). */
  fieldConfig?: Map<string, OrderFieldConfigItem> | OrderFieldConfigItem[];
};

/** Read-only vehicle fields from `vehicles` via `orders.vehicle_id`. Never mutates the vehicle. */
export function OrderLinkedVehicleDetails({
  vehicleId,
  vehicleMileageSnapshot = null,
  vehicleMileageUnitSnapshot = null,
  onOpenRelatedOrder,
  renderRow,
  fieldConfig,
}: OrderLinkedVehicleDetailsProps) {
  const { t } = useTranslation();
  const empty = t("common.noValue");
  const id = vehicleId?.trim() || "";
  const { vehicle, isLoading, isError, notFound } = useGetVehicle(id || null);
  const [detailOpen, setDetailOpen] = useState(false);
  const clientDetails = useOpenClientDetails();

  const configMap = useMemo(() => {
    if (!fieldConfig) return null;
    return fieldConfig instanceof Map ? fieldConfig : new Map(fieldConfig.map((field) => [field.key, field]));
  }, [fieldConfig]);

  const vehicleSectionLabel = configMap?.get("vehicle")?.label ?? t("vehicles.orderDetailsTitle");

  if (!id) return null;

  return (
    <section className="space-y-3" data-testid="order-linked-vehicle">
      <h3 className="min-w-0 text-sm font-medium text-foreground">{vehicleSectionLabel}</h3>

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
          <VehicleFieldsGrid
            vehicle={vehicle}
            empty={empty}
            orderMileageSnapshot={{
              value: vehicleMileageSnapshot,
              unit: vehicleMileageUnitSnapshot,
            }}
            renderRow={renderRow ? (row) => renderRow(row, id) : undefined}
            onOpenVehicle={() => setDetailOpen(true)}
            openVehicleTitle={t("vehicles.details.view")}
            fieldConfig={configMap ?? undefined}
          />
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
          onClientDeleted={clientDetails.onClientDeleted}
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
