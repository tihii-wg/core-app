import { useTranslation } from "react-i18next";
import type { MileageUnit, Vehicle } from "../../lib/types";
import { formatVehicleMileage, mileageUnitLabel } from "../vehicles/vehicleMileage";

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

export type OrderMileageSnapshotDisplay = {
  value: number | null | undefined;
  unit: MileageUnit | null | undefined;
};

export function VehicleFieldsGrid({
  vehicle,
  empty,
  hideKeys = [],
  /** When set (order details), visit mileage uses the historical snapshot — not the vehicle's live reading/unit. */
  orderMileageSnapshot,
}: {
  vehicle: Vehicle;
  empty: string;
  hideKeys?: string[];
  orderMileageSnapshot?: OrderMileageSnapshotDisplay | null;
}) {
  const { t } = useTranslation();
  const hidden = new Set(hideKeys);
  const useOrderSnapshot = orderMileageSnapshot !== undefined && orderMileageSnapshot !== null;
  const mileageUnit = useOrderSnapshot ? orderMileageSnapshot.unit : vehicle.mileageUnit;
  const currentMileage = useOrderSnapshot ? orderMileageSnapshot.value : vehicle.currentMileage;
  const currentMileageLabel = useOrderSnapshot
    ? t("vehicles.fields.visitMileage")
    : t("vehicles.fields.currentMileage");
  const rows: { key: string; label: string; value: string; mono?: boolean }[] = [
    { key: "make", label: t("vehicles.fields.make"), value: displayValue(vehicle.make, empty) },
    { key: "model", label: t("vehicles.fields.model"), value: displayValue(vehicle.model, empty) },
    { key: "year", label: t("vehicles.fields.year"), value: displayValue(vehicle.year, empty) },
    { key: "vin", label: t("vehicles.fields.vin"), value: displayValue(vehicle.vin, empty), mono: true },
    { key: "licensePlate", label: t("vehicles.fields.licensePlate"), value: displayValue(vehicle.licensePlate, empty) },
    {
      key: "mileageUnit",
      label: useOrderSnapshot ? t("vehicles.fields.visitMileageUnit") : t("vehicles.fields.mileageUnit"),
      value: mileageUnit ? mileageUnitLabel(mileageUnit, t) : empty,
    },
    {
      key: "initialMileage",
      label: t("vehicles.fields.initialMileage"),
      // Initial mileage is vehicle-level configuration, not an order visit snapshot.
      value: formatVehicleMileage(vehicle.initialMileage, vehicle.mileageUnit, t, { empty }),
    },
    {
      key: "currentMileage",
      label: currentMileageLabel,
      value: formatVehicleMileage(currentMileage, mileageUnit, t, { empty }),
    },
    {
      key: "engineDisplacement",
      label: t("vehicles.fields.engineDisplacement"),
      value: displayValue(vehicle.engineDisplacement, empty),
    },
    { key: "fuelType", label: t("vehicles.fields.fuelType"), value: fuelLabel(vehicle.fuelType, empty, (key) => t(key as never)) },
  ].filter((row) => !hidden.has(row.key));

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm" data-testid="vehicle-fields-grid">
      {rows.map((row) => (
        <div key={row.key} className={row.mono ? "col-span-2 min-w-0" : "min-w-0"}>
          <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
          <dd
            className={
              row.mono
                ? "mt-1 font-mono text-lg font-semibold tracking-wider [overflow-wrap:anywhere] text-foreground sm:text-xl"
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
