import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { Vehicle } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import {
  mileageFormValueFromVehicle,
  parseVisitMileage,
  vehicleInputWithCurrentMileage,
  visitMileageValidate,
} from "../orders/orderVehicleMileage";
import { useUpdateVehicle } from "./useVehicleMutations";

type MileageFormValues = {
  currentMileage: string;
};

type VehicleMileageFormProps = {
  vehicle: Vehicle;
  canEdit: boolean;
};

export function VehicleMileageForm({ vehicle, canEdit }: VehicleMileageFormProps) {
  const { t } = useTranslation();
  const updateVehicle = useUpdateVehicle(vehicle.clientId);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<MileageFormValues>({
    defaultValues: { currentMileage: mileageFormValueFromVehicle(vehicle) },
  });

  useEffect(() => {
    reset({ currentMileage: mileageFormValueFromVehicle(vehicle) });
  }, [vehicle, reset]);

  const busy = updateVehicle.isPending || isSubmitting;

  async function onSubmit(values: MileageFormValues) {
    const next = parseVisitMileage(values.currentMileage);
    if (next == null || next === vehicle.currentMileage) {
      reset({ currentMileage: mileageFormValueFromVehicle(vehicle) });
      return;
    }
    await updateVehicle.mutateAsync({
      vehicleId: vehicle.id,
      input: vehicleInputWithCurrentMileage(vehicle, next),
    });
  }

  return (
    <form
      className="space-y-1.5"
      onSubmit={handleSubmit(async (values) => {
        try {
          await onSubmit(values);
        } catch {
          // Mutation hook toasts API errors; field validation is shown inline.
        }
      })}
    >
      <Label htmlFor="vehicle-detail-current-mileage">{t("vehicles.fields.currentMileage")}</Label>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
        <Input
          id="vehicle-detail-current-mileage"
          inputMode="numeric"
          className="w-full min-w-0 max-w-full sm:max-w-[12rem]"
          placeholder={t("vehicles.placeholders.currentMileage")}
          disabled={!canEdit || busy}
          {...register("currentMileage", {
            validate: (value) => visitMileageValidate(value, t("vehicles.validation.mileageWholeNonNegative")),
          })}
        />
        <Button type="submit" size="sm" disabled={!canEdit || busy || !isDirty}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </div>
      {errors.currentMileage ? <p className="text-xs text-destructive">{errors.currentMileage.message}</p> : null}
      <p className="text-xs text-muted-foreground">{t("vehicles.details.mileageHint")}</p>
    </form>
  );
}
