import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MileageUnit, Order } from "../../lib/types";
import { Skeleton } from "../../ui/Skeleton";
import { ClientDetailsHost } from "../clients/ClientDetailsHost";
import { useOpenClientDetails } from "../clients/useOpenClientDetails";
import { useGetVehicle } from "../vehicles/useGetVehicle";
import { VehicleDetailPanel } from "../vehicles/VehicleDetailPanel";
import type { OrderFieldConfigItem } from "./orderFieldConfig";
import { VEHICLE_GRID_FIELD_KEY } from "./orderFieldRegistry";
import { OrderFieldEditButton } from "./OrderFieldEditButton";
import type { OrderEditField } from "./orderEditFields";
import { VehicleFieldsGrid } from "./VehicleFieldsGrid";

export { VehicleFieldsGrid };

type OrderLinkedVehicleDetailsProps = {
  vehicleId: string | null | undefined;
  /** Historical visit mileage from the order — never the vehicle's live unit/reading. */
  vehicleMileageSnapshot?: number | null;
  vehicleMileageUnitSnapshot?: MileageUnit | null;
  /** Switch the host Order Details panel to a related order (avoids nesting another Order Details sheet). */
  onOpenRelatedOrder: (order: Order) => void;
  /** Pencil on the section header (opens edit form focused on vehicle). */
  sectionEditAction?: ReactNode;
  /** When set, show per-row edit pencils using order field keys. */
  showFieldEdit?: boolean;
  onEditField?: (field: OrderEditField) => void;
  /** Order field config for labels / visibility / order (order context only). */
  fieldConfig?: Map<string, OrderFieldConfigItem> | OrderFieldConfigItem[];
};

/** Read-only vehicle fields from `vehicles` via `orders.vehicle_id`. Never mutates the vehicle. */
export function OrderLinkedVehicleDetails({
  vehicleId,
  vehicleMileageSnapshot = null,
  vehicleMileageUnitSnapshot = null,
  onOpenRelatedOrder,
  sectionEditAction,
  showFieldEdit = false,
  onEditField,
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

  const rowActions = useMemo(() => {
    if (!showFieldEdit || !onEditField) return undefined;
    const actions: Partial<Record<string, ReactNode>> = {};
    for (const [gridKey, registryKey] of Object.entries(VEHICLE_GRID_FIELD_KEY)) {
      const cfg = configMap?.get(registryKey);
      if (cfg && !cfg.visible) continue;
      const label = cfg?.label ?? t(`vehicles.fields.${gridKey === "currentMileage" ? "orderCurrentMileage" : gridKey}` as never);
      actions[gridKey] = (
        <OrderFieldEditButton field={registryKey as OrderEditField} label={label} onEdit={onEditField} />
      );
    }
    return actions;
  }, [showFieldEdit, onEditField, configMap, t]);

  if (!id) return null;

  return (
    <section className="space-y-3" data-testid="order-linked-vehicle">
      <div className="flex min-w-0 items-center justify-between gap-1">
        <h3 className="min-w-0 text-sm font-medium text-foreground">{vehicleSectionLabel}</h3>
        {sectionEditAction}
      </div>

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
            rowActions={rowActions}
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
