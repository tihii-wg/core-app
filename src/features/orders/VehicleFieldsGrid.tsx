import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MileageUnit, Vehicle } from "../../lib/types";
import { formatVehicleMileage, mileageUnitLabel } from "../vehicles/vehicleMileage";
import type { OrderFieldConfigItem } from "./orderFieldConfig";
import { VEHICLE_GRID_FIELD_KEY } from "./orderFieldRegistry";

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

type VehicleGridRow = {
  key: string;
  registryKey: string | null;
  label: string;
  value: string;
  mono?: boolean;
  sortOrder: number;
};

export function VehicleFieldsGrid({
  vehicle,
  empty,
  hideKeys = [],
  /** When set (order details), visit mileage uses the historical snapshot — not the vehicle's live reading/unit. */
  orderMileageSnapshot,
  /** Optional controls rendered on the label row for specific keys (e.g. mileage pencil). */
  rowActions,
  /**
   * Order-context field config: applies label / visibility / order overrides.
   * Omit on the standalone vehicle card so it keeps default vehicle translations.
   */
  fieldConfig,
}: {
  vehicle: Vehicle;
  empty: string;
  hideKeys?: string[];
  orderMileageSnapshot?: OrderMileageSnapshotDisplay | null;
  rowActions?: Partial<Record<string, ReactNode>>;
  fieldConfig?: Map<string, OrderFieldConfigItem> | OrderFieldConfigItem[];
}) {
  const { t } = useTranslation();
  const hidden = new Set(hideKeys);
  const useOrderSnapshot = orderMileageSnapshot !== undefined && orderMileageSnapshot !== null;
  const configMap =
    fieldConfig instanceof Map
      ? fieldConfig
      : fieldConfig
        ? new Map(fieldConfig.map((field) => [field.key, field]))
        : null;

  // Order card: the visit snapshot is shown as «Текущий пробег» with its unit inline
  // (falls back to the vehicle unit for old snapshots saved without a unit).
  const mileageUnit = useOrderSnapshot ? (orderMileageSnapshot.unit ?? vehicle.mileageUnit) : vehicle.mileageUnit;
  const currentMileage = useOrderSnapshot ? orderMileageSnapshot.value : vehicle.currentMileage;
  const defaultCurrentMileageLabel = useOrderSnapshot
    ? t("vehicles.fields.orderCurrentMileage")
    : t("vehicles.fields.currentMileage");

  const baseRows: Array<Omit<VehicleGridRow, "sortOrder"> & { defaultSort: number }> = [
    { key: "make", registryKey: "vehicleMake", label: t("vehicles.fields.make"), value: displayValue(vehicle.make, empty), defaultSort: 21 },
    { key: "model", registryKey: "vehicleModel", label: t("vehicles.fields.model"), value: displayValue(vehicle.model, empty), defaultSort: 22 },
    { key: "year", registryKey: "vehicleYear", label: t("vehicles.fields.year"), value: displayValue(vehicle.year, empty), defaultSort: 23 },
    { key: "vin", registryKey: "vehicleVin", label: t("vehicles.fields.vin"), value: displayValue(vehicle.vin, empty), mono: true, defaultSort: 25 },
    {
      key: "licensePlate",
      registryKey: "vehicleLicensePlate",
      label: t("vehicles.fields.licensePlate"),
      value: displayValue(vehicle.licensePlate, empty),
      defaultSort: 24,
    },
    {
      key: "mileageUnit",
      registryKey: null,
      label: useOrderSnapshot ? t("vehicles.fields.visitMileageUnit") : t("vehicles.fields.mileageUnit"),
      value: mileageUnit ? mileageUnitLabel(mileageUnit, t) : empty,
      defaultSort: 26.5,
    },
    {
      key: "initialMileage",
      registryKey: "vehicleInitialMileage",
      label: t("vehicles.fields.initialMileage"),
      // Initial mileage is vehicle-level configuration, not an order visit snapshot.
      value: formatVehicleMileage(vehicle.initialMileage, vehicle.mileageUnit, t, { empty }),
      defaultSort: 26,
    },
    {
      key: "currentMileage",
      registryKey: "vehicleCurrentMileage",
      label: defaultCurrentMileageLabel,
      value: formatVehicleMileage(currentMileage, mileageUnit, t, { empty }),
      defaultSort: 27,
    },
    {
      key: "engineDisplacement",
      registryKey: "vehicleEngineDisplacement",
      label: t("vehicles.fields.engineDisplacement"),
      value: displayValue(vehicle.engineDisplacement, empty),
      defaultSort: 28,
    },
    {
      key: "fuelType",
      registryKey: "vehicleFuelType",
      label: t("vehicles.fields.fuelType"),
      value: fuelLabel(vehicle.fuelType, empty, (key) => t(key as never)),
      defaultSort: 29,
    },
  ];

  const rows: VehicleGridRow[] = baseRows
    .filter((row) => !hidden.has(row.key) && !(useOrderSnapshot && row.key === "mileageUnit"))
    .filter((row) => {
      if (!configMap || !row.registryKey) return true;
      const cfg = configMap.get(row.registryKey);
      return cfg ? cfg.visible : true;
    })
    .map((row) => {
      const cfg = row.registryKey && configMap ? configMap.get(row.registryKey) : undefined;
      return {
        key: row.key,
        registryKey: row.registryKey,
        label: cfg?.label ?? row.label,
        value: row.value,
        mono: row.mono,
        sortOrder: cfg?.sortOrder ?? row.defaultSort,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm" data-testid="vehicle-fields-grid">
      {rows.map((row) => {
        const editKey = row.registryKey ?? VEHICLE_GRID_FIELD_KEY[row.key] ?? row.key;
        return (
          <div key={row.key} className="min-w-0" data-edit-field={configMap ? editKey : undefined}>
            <dt className="flex min-w-0 items-center justify-between gap-1 text-xs font-medium text-muted-foreground">
              <span className="min-w-0">{row.label}</span>
              {rowActions?.[row.key]}
            </dt>
            <dd
              className={
                row.mono
                  ? "mt-1 font-mono text-base font-semibold tracking-wide [overflow-wrap:anywhere] text-foreground sm:text-lg"
                  : "mt-1 font-medium [overflow-wrap:anywhere] text-foreground"
              }
            >
              {row.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
