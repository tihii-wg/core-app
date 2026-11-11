import { ChevronRight, Phone } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ClientType, MileageUnit, Order } from "../../lib/types";
import { cn } from "../../lib/utils";
import ClientTypeBadge from "../clients/ClientTypeBadge";
import { industrySupportsClientVehicles } from "../industries/industryCapabilities";
import { shouldShowOrderAssetValue, type IndustryWorkflow } from "../industries/industryWorkflow";
import { useGetVehicle } from "../vehicles/useGetVehicle";
import { vehicleDisplayLabel, vehicleMakeModelLabel } from "../../services/apiVehicles";
import { Skeleton } from "../../ui/Skeleton";

export type OrderClientCardProps = {
  order: Order;
  workflow: IndustryWorkflow;
  /** Industry copy labels for non-vehicle asset fields (device / object). */
  deviceLabel: string;
  carNumberLabel: string;
  vinLabel: string;
  interactive: boolean;
  onChangeRequest: () => void;
  onOpenClient?: (clientId: string) => void;
  /**
   * Full vehicle / asset block rendered inside the same card, below the client data (not part of the
   * clickable area, so its own links and inline fields keep working). Replaces the one-line summary.
   */
  details?: ReactNode;
};

function AssetSummaryLine({
  order,
  deviceLabel,
  carNumberLabel,
  vinLabel,
  workflow,
}: {
  order: Order;
  deviceLabel: string;
  carNumberLabel: string;
  vinLabel: string;
  workflow: IndustryWorkflow;
}) {
  const parts: string[] = [];
  if (shouldShowOrderAssetValue(workflow.orderFields.device, order.device, "device") && order.device?.trim()) {
    parts.push(`${deviceLabel}: ${order.device.trim()}`);
  }
  if (shouldShowOrderAssetValue(workflow.orderFields.carNumber, order.carNumber, "carNumber") && order.carNumber?.trim()) {
    parts.push(`${carNumberLabel}: ${order.carNumber.trim()}`);
  }
  if (shouldShowOrderAssetValue(workflow.orderFields.vin, order.vin, "vin") && order.vin?.trim()) {
    parts.push(`${vinLabel}: ${order.vin.trim()}`);
  }
  if (parts.length === 0) return null;
  return (
    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" data-testid="order-client-card-asset">
      {parts.join(" · ")}
    </p>
  );
}

function VehicleSummary({
  vehicleId,
  mileageSnapshot,
  mileageUnitSnapshot,
}: {
  vehicleId: string | null | undefined;
  mileageSnapshot?: number | null;
  mileageUnitSnapshot?: MileageUnit | null;
}) {
  const { t } = useTranslation();
  const id = vehicleId?.trim() || "";
  const { vehicle, isLoading, isError, notFound } = useGetVehicle(id || null);

  if (!id) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="order-client-card-vehicle">
        {t("orders.changeClient.noVehicle")}
      </p>
    );
  }

  if (isLoading) {
    return <Skeleton className="h-4 w-2/3" data-testid="order-client-card-vehicle-loading" />;
  }

  if (isError || notFound || !vehicle) {
    return (
      <p className="text-sm text-destructive" data-testid="order-client-card-vehicle">
        {t("vehicles.errors.notFound")}
      </p>
    );
  }

  const title = vehicleMakeModelLabel(vehicle) || vehicleDisplayLabel(vehicle);
  const plate = vehicle.licensePlate?.trim();
  const vin = vehicle.vin?.trim();
  const mileage =
    mileageSnapshot != null && Number.isFinite(mileageSnapshot)
      ? `${mileageSnapshot}${mileageUnitSnapshot ? ` ${mileageUnitSnapshot}` : ""}`
      : null;

  return (
    <div className="space-y-0.5 text-sm" data-testid="order-client-card-vehicle">
      <p className="font-medium text-foreground [overflow-wrap:anywhere]">{title}</p>
      <p className="text-muted-foreground [overflow-wrap:anywhere]">
        {[plate ? `${t("vehicles.fields.licensePlate")}: ${plate}` : null, vin ? `${t("vehicles.fields.vin")}: ${vin}` : null, mileage]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}

export function OrderClientCard({
  order,
  workflow,
  deviceLabel,
  carNumberLabel,
  vinLabel,
  interactive,
  onChangeRequest,
  onOpenClient,
  details,
}: OrderClientCardProps) {
  const { t } = useTranslation();
  const showVehicles = industrySupportsClientVehicles(workflow);
  const clientId = order.clientId?.trim() ?? "";
  const hasClient = Boolean(clientId);
  const phone = order.clientPhone?.trim() ?? "";
  const clientType = order.clientType as ClientType | null | undefined;

  const body = (
    <>
      <div className="min-w-0 flex-1 space-y-1">
        {hasClient ? (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="min-w-0 font-medium text-foreground [overflow-wrap:anywhere]">{order.clientName}</p>
              {clientType ? <ClientTypeBadge clientType={clientType} /> : null}
            </div>
            {phone ? (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Phone className="size-3.5 shrink-0" />
                <span className="tabular-nums">{phone}</span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("clients.combobox.noPhone")}</p>
            )}
          </>
        ) : (
          <p className="font-medium text-primary">{t("orders.changeClient.addClient")}</p>
        )}

        {details ? null : (
        <div className="border-t border-border pt-2">
          {showVehicles ? (
            <VehicleSummary
              vehicleId={order.vehicleId}
              mileageSnapshot={order.vehicleMileageSnapshot}
              mileageUnitSnapshot={order.vehicleMileageUnitSnapshot}
            />
          ) : (
            <AssetSummaryLine
              order={order}
              workflow={workflow}
              deviceLabel={deviceLabel}
              carNumberLabel={carNumberLabel}
              vinLabel={vinLabel}
            />
          )}
        </div>
        )}

        {hasClient && onOpenClient ? (
          <span
            role="link"
            tabIndex={0}
            className="mt-1 inline-flex cursor-pointer text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
            data-testid="order-client-card-open-client"
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              onOpenClient(clientId);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.stopPropagation();
              event.preventDefault();
              onOpenClient(clientId);
            }}
          >
            {t("orders.changeClient.openClientCard")}
          </span>
        ) : null}
      </div>

      {interactive ? (
        <span className="flex shrink-0 items-center gap-1 self-center text-xs font-medium text-muted-foreground">
          <span className="hidden sm:inline">{t("orders.changeClient.changeHint")}</span>
          <ChevronRight className="size-4" aria-hidden />
        </span>
      ) : null}
    </>
  );

  const className = cn(
    "flex w-full min-w-0 items-start gap-3 p-4 text-left transition-colors",
    details ? "rounded-t-lg" : "rounded-lg border border-border bg-muted/50",
    interactive &&
      "cursor-pointer hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35",
    interactive && !details && "hover:border-primary/40",
  );

  const withDetails = (header: ReactNode) =>
    details ? (
      <div className="min-w-0 rounded-lg border border-border bg-muted/50" data-testid="order-client-card-shell">
        {header}
        <div className="border-t border-border p-4" data-testid="order-client-card-details">
          {details}
        </div>
      </div>
    ) : (
      header
    );

  if (interactive) {
    return withDetails(
      <div
        role="button"
        tabIndex={0}
        data-testid="order-client-card"
        className={className}
        onClick={onChangeRequest}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onChangeRequest();
          }
        }}
        aria-label={hasClient ? t("orders.changeClient.changeTitle") : t("orders.changeClient.addClient")}
      >
        {body}
      </div>,
    );
  }

  return withDetails(
    <div data-testid="order-client-card" className={className} aria-readonly="true">
      {body}
    </div>,
  );
}
