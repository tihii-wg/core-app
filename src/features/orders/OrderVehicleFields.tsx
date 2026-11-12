import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Control, FieldErrors, FieldValues, Path, PathValue, UseFormRegister, UseFormSetValue } from "react-hook-form";
import { Controller, useWatch } from "react-hook-form";
import { Plus } from "lucide-react";
import type { Vehicle } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Label } from "../../ui/Label";
import { MileageInput } from "../../ui/MileageInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { mileageValidate } from "../../lib/mileage";
import { orderAssetFieldsFromVehicle, vehicleDisplayLabel, vehicleSummaryDetails } from "../../services/apiVehicles";
import { useGetClientVehicles } from "../vehicles/useGetClientVehicles";
import { useCreateVehicle } from "../vehicles/useVehicleMutations";
import { VehicleFormDialog } from "../vehicles/VehicleFormDialog";
import { mileageUnitAbbreviation, mileageUnitLabel } from "../vehicles/vehicleMileage";
import type { OrderFieldConfigItem } from "./orderFieldConfig";
import { VehicleFieldsGrid } from "./VehicleFieldsGrid";
import {
  intakeMileageBelowKnownMessage,
  isIntakeMileageBelowKnown,
  lastKnownMileageHint,
  mileageFormValueFromVehicle,
  parseVisitMileage,
} from "./orderVehicleMileage";

const NONE = "__none__";

type OrderVehicleFieldsProps<T extends FieldValues> = {
  control: Control<T>;
  setValue: UseFormSetValue<T>;
  register: UseFormRegister<T>;
  errors?: FieldErrors;
  clientId: string;
  disabled?: boolean;
  /**
   * How to initialize intake mileage when the selected vehicle changes.
   * - `empty`: clear the field (legacy / rare).
   * - `vehicle` (new + change-client + edit after vehicle change): prefill current ?? initial.
   */
  mileageMode?: "empty" | "vehicle";
  /**
   * When true, keep the form's seeded `currentMileage` (order historical snapshot) until the
   * selected vehicle id changes. Prevents live vehicle mileage from overwriting history on open.
   */
  preserveInitialMileage?: boolean;
  /**
   * When true (edit orders), keep seeded `device` / `carNumber` / `vin` until the selected
   * vehicle id changes. Create forms must leave this false so a preselected `initialVehicleId`
   * still snapshots make/model/plate into the order columns the Orders list renders.
   */
  preserveInitialAssetSnapshot?: boolean;
  /** Workspace order-field config (vehicle labels / visibility / required). */
  fieldConfig?: Map<string, OrderFieldConfigItem>;
};

function applyOrderAssetSnapshot<T extends FieldValues>(setValue: UseFormSetValue<T>, vehicle: Vehicle | undefined) {
  const snapshot = orderAssetFieldsFromVehicle(vehicle);
  const options = { shouldDirty: true, shouldValidate: false } as const;
  setValue("device" as Path<T>, snapshot.device as PathValue<T, Path<T>>, options);
  setValue("carNumber" as Path<T>, snapshot.carNumber as PathValue<T, Path<T>>, options);
  setValue("vin" as Path<T>, snapshot.vin as PathValue<T, Path<T>>, options);
}

function applyVisitMileage<T extends FieldValues>(
  setValue: UseFormSetValue<T>,
  value: string,
  options: { shouldDirty: boolean },
) {
  setValue("currentMileage" as Path<T>, value as PathValue<T, Path<T>>, {
    shouldDirty: options.shouldDirty,
    shouldValidate: false,
  });
}

export function OrderVehicleFields<T extends FieldValues>({
  control,
  setValue,
  register,
  errors,
  clientId,
  disabled,
  mileageMode = "vehicle",
  preserveInitialMileage = false,
  preserveInitialAssetSnapshot = false,
  fieldConfig,
}: OrderVehicleFieldsProps<T>) {
  const { t, i18n } = useTranslation();
  const vehicleIdPath = "vehicleId" as Path<T>;
  const selectedVehicleId = useWatch({ control, name: vehicleIdPath }) as string | undefined;
  const intakeMileageRaw = useWatch({ control, name: "currentMileage" as Path<T> }) as string | undefined;
  const { vehicles, isLoading, isFetched, isError } = useGetClientVehicles(clientId || null);
  const createVehicle = useCreateVehicle(clientId);
  const [createOpen, setCreateOpen] = useState(false);
  /** Optimistic row so the selector/summary work before the client vehicles query settles. */
  const [createdVehicle, setCreatedVehicle] = useState<Vehicle | null>(null);
  /** Skip the first asset sync only when editing (preserve historical order snapshot columns). */
  const skipInitialAssetSync = useRef(preserveInitialAssetSnapshot);
  /** Last vehicle id we wrote device/carNumber/vin for (waits until the row is in `vehicles`). */
  const syncedAssetVehicleId = useRef<string | null>(null);
  /** Last vehicle id we synced currentMileage for. */
  const syncedMileageVehicleId = useRef<string | null>(null);
  /** Skip the first mileage sync so edit forms keep the order's historical snapshot seed. */
  const skipInitialMileageSync = useRef(preserveInitialMileage);
  /** Protect a just-created selection from being cleared while the list refetches / Select resyncs. */
  const pendingCreatedVehicleId = useRef<string | null>(null);

  const vehiclesForSelect = useMemo(() => {
    if (!createdVehicle) return vehicles;
    if (vehicles.some((vehicle) => vehicle.id === createdVehicle.id)) return vehicles;
    return [createdVehicle, ...vehicles];
  }, [createdVehicle, vehicles]);

  const selectedVehicle = selectedVehicleId
    ? vehiclesForSelect.find((vehicle) => vehicle.id === selectedVehicleId)
    : undefined;
  const mileageError = errors?.currentMileage as { message?: string } | undefined;

  useEffect(() => {
    if (!createdVehicle) return;
    // Drop the optimistic row once the query list includes it. Keep pendingCreatedVehicleId
    // until the selection is stable — Radix Select can emit a spurious clear while syncing.
    if (vehicles.some((vehicle) => vehicle.id === createdVehicle.id)) {
      setCreatedVehicle(null);
    }
  }, [createdVehicle, vehicles]);

  useEffect(() => {
    const pendingId = pendingCreatedVehicleId.current;
    if (!pendingId) return;
    if (selectedVehicleId === pendingId && vehicles.some((vehicle) => vehicle.id === pendingId)) {
      pendingCreatedVehicleId.current = null;
    }
  }, [selectedVehicleId, vehicles]);

  useEffect(() => {
    if (!clientId) {
      setValue(vehicleIdPath, "" as PathValue<T, Path<T>>);
      setCreatedVehicle(null);
      pendingCreatedVehicleId.current = null;
      return;
    }
    // Wait until the client vehicle list has settled. Clearing on a brief empty
    // array (loading / error / refetch) left device/plate/VIN snapshots in place
    // while wiping vehicleId — orders then appeared in Client history but not on
    // the Vehicle card (which filters by orders.vehicle_id).
    if (isLoading || !isFetched || isError) return;
    if (
      selectedVehicleId &&
      pendingCreatedVehicleId.current === selectedVehicleId &&
      !vehiclesForSelect.some((vehicle) => vehicle.id === selectedVehicleId)
    ) {
      // Keep the just-created selection until the optimistic/cache row is available.
      return;
    }
    if (selectedVehicleId && !vehiclesForSelect.some((vehicle) => vehicle.id === selectedVehicleId)) {
      setValue(vehicleIdPath, "" as PathValue<T, Path<T>>);
    }
  }, [clientId, isError, isFetched, isLoading, selectedVehicleId, setValue, vehicleIdPath, vehiclesForSelect]);

  useEffect(() => {
    if (isLoading) return;

    const nextId = selectedVehicleId?.trim() || "";

    if (skipInitialAssetSync.current) {
      skipInitialAssetSync.current = false;
      syncedAssetVehicleId.current = nextId;
      return;
    }

    if (syncedAssetVehicleId.current === nextId) return;

    // Id changed but the vehicle row is not in the list yet (e.g. just created) — wait.
    if (nextId && !selectedVehicle) return;

    syncedAssetVehicleId.current = nextId;
    applyOrderAssetSnapshot(setValue, selectedVehicle);
  }, [isLoading, selectedVehicle, selectedVehicleId, setValue]);

  // Sync intake mileage when the selected vehicle changes.
  // `vehicle`: prefill current ?? initial. `empty`: clear. With `preserveInitialMileage`,
  // keep the order snapshot seed until the vehicle id changes.
  useEffect(() => {
    if (isLoading) return;

    const nextId = selectedVehicleId?.trim() || "";
    if (syncedMileageVehicleId.current === nextId) return;
    if (nextId && !selectedVehicle) return;

    if (skipInitialMileageSync.current) {
      skipInitialMileageSync.current = false;
      syncedMileageVehicleId.current = nextId;
      return;
    }

    syncedMileageVehicleId.current = nextId;
    const nextMileage =
      mileageMode === "vehicle" ? mileageFormValueFromVehicle(selectedVehicle) : "";
    applyVisitMileage(setValue, nextMileage, { shouldDirty: false });
  }, [isLoading, mileageMode, selectedVehicle, selectedVehicleId, setValue]);

  if (!clientId) return null;

  const summary = selectedVehicle ? vehicleSummaryDetails(selectedVehicle) : null;
  // Only show km/mi next to the reading when the vehicle has an explicit unit.
  // Never invent a unit or show "ед.?" as if it were a disabled selector.
  const mileageUnitAbbr = selectedVehicle ? mileageUnitAbbreviation(selectedVehicle.mileageUnit, t) : "";

  const vehicleCfg = fieldConfig?.get("vehicle");
  const mileageCfg = fieldConfig?.get("vehicleCurrentMileage");
  const vehicleRequired = Boolean(vehicleCfg?.required);
  const mileageRequired = Boolean(mileageCfg?.required);
  const mileageVisible = mileageCfg?.visible !== false;
  // Intake label unless a stored override renamed the field.
  const mileageLabel =
    mileageCfg?.definitionId && mileageCfg.label.trim()
      ? mileageCfg.label
      : t("vehicles.fields.intakeMileage");
  const vehicleLabel = vehicleCfg?.label ?? t("vehicles.selectLabel");

  let intakeReading: number | null = null;
  try {
    intakeReading = parseVisitMileage(intakeMileageRaw);
  } catch {
    intakeReading = null;
  }
  const showBelowKnownWarning =
    Boolean(selectedVehicle) &&
    isIntakeMileageBelowKnown({
      reading: intakeReading,
      readingUnit: selectedVehicle?.mileageUnit,
      vehicle: selectedVehicle,
    });
  const lastKnownHint = selectedVehicle
    ? lastKnownMileageHint(selectedVehicle, t, {
        formatDate: (iso) => {
          try {
            return new Intl.DateTimeFormat(i18n.language || undefined, {
              dateStyle: "medium",
            }).format(new Date(iso));
          } catch {
            return iso;
          }
        },
      })
    : null;

  return (
    <div className="space-y-2" data-edit-field="vehicle">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="order-vehicle">
          {vehicleLabel}
          {vehicleRequired ? <span className="text-destructive"> *</span> : null}
        </Label>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || createVehicle.isPending} onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          {t("vehicles.add")}
        </Button>
      </div>
      <Controller
        name={vehicleIdPath}
        control={control}
        rules={
          vehicleRequired
            ? {
                validate: (value) =>
                  Boolean(String(value ?? "").trim()) || t("settings.orderFields.validation.required"),
              }
            : undefined
        }
        render={({ field }) => (
          <Select
            value={(field.value as string) || NONE}
            onValueChange={(value) => {
              const next = value === NONE ? "" : value;
              // Radix Select (especially inside a parent <form>) can emit an empty value while
              // options resync after an inline create — do not drop the new selection.
              if (!next && pendingCreatedVehicleId.current && pendingCreatedVehicleId.current === field.value) {
                return;
              }
              field.onChange(next);
            }}
            disabled={disabled || isLoading}
          >
            <SelectTrigger id="order-vehicle" className="w-full min-w-0">
              <SelectValue placeholder={isLoading ? t("common.loading") : t("vehicles.selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("vehicles.noneSelected")}</SelectItem>
              {vehiclesForSelect.map((vehicle: Vehicle) => (
                <SelectItem key={vehicle.id} value={vehicle.id}>
                  {vehicleDisplayLabel(vehicle)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />

      {selectedVehicle ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 space-y-3" data-testid="selected-vehicle-summary">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t("vehicles.selectedSummary")}</p>
            <p className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">{summary?.title}</p>
            <VehicleFieldsGrid
              vehicle={selectedVehicle}
              empty={t("common.noValue")}
              fieldConfig={fieldConfig}
              // The «Пробег при приёме» input below is the only mileage entered here; showing the vehicle's
              // stored mileage again (often empty) next to it was confusing.
              hideKeys={["currentMileage"]}
            />
            <p className="text-xs text-muted-foreground">{t("vehicles.selectedSummaryHint")}</p>
          </div>

          {mileageVisible ? (
            <div className="space-y-1.5 border-t border-border pt-3" data-edit-field="vehicleCurrentMileage">
              <Label htmlFor="order-vehicle-current-mileage">
                {mileageLabel}
                {mileageRequired ? <span className="text-destructive"> *</span> : null}
                {mileageUnitAbbr ? (
                  <span className="ml-1 font-normal text-muted-foreground">({mileageUnitAbbr})</span>
                ) : null}
              </Label>
              <MileageInput
                id="order-vehicle-current-mileage"
                unitSuffix={mileageUnitAbbr || undefined}
                placeholder={t("vehicles.placeholders.intakeMileage")}
                disabled={disabled}
                data-testid="order-intake-mileage"
                {...register("currentMileage" as Path<T>, {
                  validate: (value) => {
                    const text = String(value ?? "").trim();
                    if (mileageRequired && !text) return t("settings.orderFields.validation.required");
                    return mileageValidate(String(value ?? ""), t);
                  },
                })}
              />
              {mileageError?.message ? <p className="text-xs text-destructive">{mileageError.message}</p> : null}
              {lastKnownHint ? (
                <p className="text-xs text-muted-foreground" data-testid="order-intake-mileage-last-known">
                  {lastKnownHint}
                </p>
              ) : null}
              {showBelowKnownWarning && selectedVehicle ? (
                <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="order-intake-mileage-below-warning">
                  {intakeMileageBelowKnownMessage(selectedVehicle, t)}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {t("vehicles.mileage.readingUnit", {
                  unit: mileageUnitLabel(selectedVehicle.mileageUnit, t),
                })}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {!isLoading && vehiclesForSelect.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("vehicles.emptyForOrder")}</p>
      ) : null}

      <VehicleFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("vehicles.addTitle")}
        description={t("vehicles.addFromOrderDescription")}
        submitting={createVehicle.isPending}
        mode="create"
        onSubmit={async (input) => {
          const created = await createVehicle.mutateAsync(input);
          pendingCreatedVehicleId.current = created.id;
          // Ensure the new option exists in the Select before setting its value; otherwise Radix
          // can emit an empty onValueChange while options catch up (worse inside a parent form).
          flushSync(() => {
            setCreatedVehicle(created);
          });
          setValue(vehicleIdPath, created.id as PathValue<T, Path<T>>, { shouldDirty: true });
          syncedAssetVehicleId.current = created.id;
          syncedMileageVehicleId.current = created.id;
          skipInitialAssetSync.current = false;
          applyOrderAssetSnapshot(setValue, created);
          // Explicit snapshot from the create form value (initial = current on create).
          applyVisitMileage(setValue, mileageFormValueFromVehicle(created), { shouldDirty: true });
        }}
      />
    </div>
  );
}
