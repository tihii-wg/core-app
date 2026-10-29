import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Control, FieldValues, Path, PathValue, UseFormSetValue } from "react-hook-form";
import { Controller, useWatch } from "react-hook-form";
import { Plus } from "lucide-react";
import type { Vehicle } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { vehicleDisplayLabel, vehicleSummaryDetails } from "../../services/apiVehicles";
import { useGetClientVehicles } from "../vehicles/useGetClientVehicles";
import { useCreateVehicle } from "../vehicles/useVehicleMutations";
import { VehicleFormDialog } from "../vehicles/VehicleFormDialog";

const NONE = "__none__";

type OrderVehicleFieldsProps<T extends FieldValues> = {
  control: Control<T>;
  setValue: UseFormSetValue<T>;
  clientId: string;
  disabled?: boolean;
};

export function OrderVehicleFields<T extends FieldValues>({ control, setValue, clientId, disabled }: OrderVehicleFieldsProps<T>) {
  const { t } = useTranslation();
  const vehicleIdPath = "vehicleId" as Path<T>;
  const selectedVehicleId = useWatch({ control, name: vehicleIdPath }) as string | undefined;
  const { vehicles, isLoading } = useGetClientVehicles(clientId || null);
  const createVehicle = useCreateVehicle(clientId);
  const [createOpen, setCreateOpen] = useState(false);

  const selectedVehicle = selectedVehicleId ? vehicles.find((vehicle) => vehicle.id === selectedVehicleId) : undefined;

  useEffect(() => {
    if (!clientId) {
      setValue(vehicleIdPath, "" as PathValue<T, Path<T>>);
      return;
    }
    // Wait until the client vehicle list has loaded so a brief empty array does not clear a valid selection.
    if (isLoading) return;
    if (selectedVehicleId && !vehicles.some((vehicle) => vehicle.id === selectedVehicleId)) {
      setValue(vehicleIdPath, "" as PathValue<T, Path<T>>);
    }
  }, [clientId, isLoading, selectedVehicleId, setValue, vehicleIdPath, vehicles]);

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
            onValueChange={(value) => field.onChange(value === NONE ? "" : value)}
            disabled={disabled || isLoading}
          >
            <SelectTrigger id="order-vehicle">
              <SelectValue placeholder={isLoading ? t("common.loading") : t("vehicles.selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("vehicles.noneSelected")}</SelectItem>
              {vehicles.map((vehicle: Vehicle) => (
                <SelectItem key={vehicle.id} value={vehicle.id}>
                  {vehicleDisplayLabel(vehicle)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />

      {summary ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2" data-testid="selected-vehicle-summary">
          <p className="text-xs font-medium text-muted-foreground">{t("vehicles.selectedSummary")}</p>
          <p className="mt-0.5 text-sm font-medium text-foreground [overflow-wrap:anywhere]">{summary.title}</p>
          {summary.details.length > 0 ? (
            <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">{summary.details.join(" · ")}</p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">{t("vehicles.selectedSummaryHint")}</p>
        </div>
      ) : null}

      {!isLoading && vehicles.length === 0 ? (
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
          setValue(vehicleIdPath, created.id as PathValue<T, Path<T>>, { shouldDirty: true });
        }}
      />
    </div>
  );
}
