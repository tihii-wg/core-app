import { useTranslation } from "react-i18next";
import type { Vehicle } from "../../lib/types";
import { Skeleton } from "../../ui/Skeleton";
import { useGetVehicle } from "../vehicles/useGetVehicle";

type OrderLinkedVehicleDetailsProps = {
  vehicleId: string | null | undefined;
};

function displayValue(value: string | number | null | undefined, empty: string): string {
  if (value == null) return empty;
  if (typeof value === "string" && value.trim() === "") return empty;
  return String(value);
}

function fuelLabel(fuelType: string | null, empty: string, translate: (key: string) => string) {
  if (!fuelType?.trim()) return empty;
  const key = `vehicles.fuel.${fuelType}`;
  const label = translate(key);
  return label === key ? fuelType : label;
}

/** Read-only vehicle fields from `vehicles` via `orders.vehicle_id`. Never mutates the vehicle. */
export function OrderLinkedVehicleDetails({ vehicleId }: OrderLinkedVehicleDetailsProps) {
  const { t } = useTranslation();
  const empty = t("common.noValue");
  const id = vehicleId?.trim() || "";
  const { vehicle, isLoading, isError, notFound } = useGetVehicle(id || null);

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
        <VehicleFieldsGrid vehicle={vehicle} empty={empty} />
      )}
    </section>
  );
}

export function VehicleFieldsGrid({ vehicle, empty }: { vehicle: Vehicle; empty: string }) {
  const { t } = useTranslation();
  const rows: { key: string; label: string; value: string; mono?: boolean }[] = [
    { key: "make", label: t("vehicles.fields.make"), value: displayValue(vehicle.make, empty) },
    { key: "model", label: t("vehicles.fields.model"), value: displayValue(vehicle.model, empty) },
    { key: "year", label: t("vehicles.fields.year"), value: displayValue(vehicle.year, empty) },
    { key: "vin", label: t("vehicles.fields.vin"), value: displayValue(vehicle.vin, empty), mono: true },
    { key: "licensePlate", label: t("vehicles.fields.licensePlate"), value: displayValue(vehicle.licensePlate, empty) },
    { key: "initialMileage", label: t("vehicles.fields.initialMileage"), value: displayValue(vehicle.initialMileage, empty) },
    { key: "currentMileage", label: t("vehicles.fields.currentMileage"), value: displayValue(vehicle.currentMileage, empty) },
    {
      key: "engineDisplacement",
      label: t("vehicles.fields.engineDisplacement"),
      value: displayValue(vehicle.engineDisplacement, empty),
    },
    { key: "fuelType", label: t("vehicles.fields.fuelType"), value: fuelLabel(vehicle.fuelType, empty, (key) => t(key as never)) },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm" data-testid="vehicle-fields-grid">
      {rows.map((row) => (
        <div key={row.key} className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
          <dd
            className={
              row.mono
                ? "mt-1 font-mono text-[13px] [overflow-wrap:anywhere] text-foreground"
                : "mt-1 font-medium [overflow-wrap:anywhere] text-foreground"
            }
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
