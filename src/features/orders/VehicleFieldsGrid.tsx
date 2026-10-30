import { useTranslation } from "react-i18next";
import type { Vehicle } from "../../lib/types";

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

export function VehicleFieldsGrid({
  vehicle,
  empty,
  hideKeys = [],
}: {
  vehicle: Vehicle;
  empty: string;
  hideKeys?: string[];
}) {
  const { t } = useTranslation();
  const hidden = new Set(hideKeys);
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
  ].filter((row) => !hidden.has(row.key));

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm" data-testid="vehicle-fields-grid">
      {rows.map((row) => (
        <div key={row.key} className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
          <dd
            className={
              row.mono
                ? "mt-1 font-mono text-[13px] font-semibold [overflow-wrap:anywhere] text-foreground"
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
