import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Control, FieldErrors, FieldValues, Path, PathValue, UseFormRegister, UseFormSetValue } from "react-hook-form";
import { Controller, useWatch } from "react-hook-form";
import { Plus } from "lucide-react";
import type { Vehicle } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { orderAssetFieldsFromVehicle, vehicleDisplayLabel, vehicleSummaryDetails } from "../../services/apiVehicles";
import { useGetClientVehicles } from "../vehicles/useGetClientVehicles";
import { useCreateVehicle } from "../vehicles/useVehicleMutations";
import { VehicleFormDialog } from "../vehicles/VehicleFormDialog";
import { VehicleFieldsGrid } from "./OrderLinkedVehicleDetails";
import { mileageFormValueFromVehicle, visitMileageValidate } from "./orderVehicleMileage";

const NONE = "__none__";

type OrderVehicleFieldsProps<T extends FieldValues> = {
  control: Control<T>;
  setValue: UseFormSetValue<T>;
  register: UseFormRegister<T>;
  errors?: FieldErrors;
  clientId: string;
  disabled?: boolean;
  /**
   * How to initialize Current mileage when the selected vehicle changes.
   * - `empty` (new orders): never carry over stored mileage; user enters visit mileage explicitly.
   * - `vehicle` (edit orders): prefill from `vehicles.current_mileage`.
   */
  mileageMode?: "empty" | "vehicle";
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
  mileageMode = "empty",
}: OrderVehicleFieldsProps<T>) {
  const { t } = useTranslation();
  const vehicleIdPath = "vehicleId" as Path<T>;
  const selectedVehicleId = useWatch({ control, name: vehicleIdPath }) as string | undefined;
  const { vehicles, isLoading } = useGetClientVehicles(clientId || null);
  const createVehicle = useCreateVehicle(clientId);
  const [createOpen, setCreateOpen] = useState(false);
  /** Optimistic row so the selector/summary work before the client vehicles query settles. */
  const [createdVehicle, setCreatedVehicle] = useState<Vehicle | null>(null);
  /** Skip the first sync so edit forms keep existing order snapshot columns until the user changes vehicle. */
  const skipInitialAssetSync = useRef(true);
  /** Last vehicle id we wrote device/carNumber/vin for (waits until the row is in `vehicles`). */
  const syncedAssetVehicleId = useRef<string | null>(null);
  /** Last vehicle id we synced currentMileage for. */
  const syncedMileageVehicleId = useRef<string | null>(null);
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
    // Wait until the client vehicle list has loaded so a brief empty array does not clear a valid selection.
    if (isLoading) return;
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
  }, [clientId, isLoading, selectedVehicleId, setValue, vehicleIdPath, vehiclesForSelect]);

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

  // Sync visit mileage when the selected vehicle changes.
  // Create (`empty`): clear the field so stored mileage is never carried into a new visit.
  // Edit (`vehicle`): prefill from vehicles.current_mileage.
  useEffect(() => {
    if (isLoading) return;

    const nextId = selectedVehicleId?.trim() || "";
    if (syncedMileageVehicleId.current === nextId) return;
    if (nextId && !selectedVehicle) return;

    syncedMileageVehicleId.current = nextId;
    const nextMileage =
      mileageMode === "vehicle" ? mileageFormValueFromVehicle(selectedVehicle) : "";
    applyVisitMileage(setValue, nextMileage, { shouldDirty: false });
  }, [isLoading, mileageMode, selectedVehicle, selectedVehicleId, setValue]);

  if (!clientId) return null;

  const summary = selectedVehicle ? vehicleSummaryDetails(selectedVehicle) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="order-vehicle">{t("vehicles.selectLabel")}</Label>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || createVehicle.isPending} onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          {t("vehicles.add")}
        </Button>
      </div>
      <Controller
        name={vehicleIdPath}
        control={control}
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
            <VehicleFieldsGrid vehicle={selectedVehicle} empty={t("common.noValue")} />
            <p className="text-xs text-muted-foreground">{t("vehicles.selectedSummaryHint")}</p>
          </div>

          <div className="space-y-1.5 border-t border-border pt-3">
            <Label htmlFor="order-vehicle-current-mileage">{t("vehicles.fields.currentMileage")}</Label>
            <Input
              id="order-vehicle-current-mileage"
              inputMode="numeric"
              className="w-full min-w-0 max-w-full sm:max-w-[12rem]"
              placeholder={t("vehicles.placeholders.currentMileage")}
              disabled={disabled}
              {...register("currentMileage" as Path<T>, {
                validate: (value) =>
                  visitMileageValidate(String(value ?? ""), t("vehicles.validation.mileageWholeNonNegative")),
              })}
            />
            {mileageError?.message ? <p className="text-xs text-destructive">{mileageError.message}</p> : null}
          </div>
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
          applyVisitMileage(
            setValue,
            mileageMode === "vehicle" ? mileageFormValueFromVehicle(created) : "",
            { shouldDirty: false },
          );
        }}
      />
    </div>
  );
}
