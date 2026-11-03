import type { FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { parseOptionalVehicleNumber } from "../../services/apiVehicles";
import { optionalVinValidate } from "../../lib/vin";
import { MILEAGE_UNITS, mileageUnitAbbreviation } from "./vehicleMileage";
import { VEHICLE_FUEL_TYPES, type VehicleFormValues } from "./vehicleForm";

type VehicleFieldsProps = {
  idPrefix?: string;
  register: UseFormRegister<VehicleFormValues>;
  setValue: UseFormSetValue<VehicleFormValues>;
  watch: UseFormWatch<VehicleFormValues>;
  errors: FieldErrors<VehicleFormValues>;
  disabled?: boolean;
};

export function VehicleFields({ idPrefix = "vehicle", register, setValue, watch, errors, disabled }: VehicleFieldsProps) {
  const { t } = useTranslation();
  const fuelType = watch("fuelType");
  const mileageUnit = watch("mileageUnit");
  const fuelNone = "__none__";
  // Stable controlled value for Radix (empty string is invalid). Not offered as a selectable option.
  const unitUnset = "__unset__";
  // Only show a unit abbreviation next to mileage inputs when a real unit is selected.
  // Never show "ед.?" / "unit?" as if it were a disabled control.
  const unitAbbr = mileageUnitAbbreviation(mileageUnit || null);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-make`}>{t("vehicles.fields.make")}</Label>
          <Input id={`${idPrefix}-make`} {...register("make")} placeholder={t("vehicles.placeholders.make")} disabled={disabled} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-model`}>{t("vehicles.fields.model")}</Label>
          <Input id={`${idPrefix}-model`} {...register("model")} placeholder={t("vehicles.placeholders.model")} disabled={disabled} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-year`}>{t("vehicles.fields.year")}</Label>
          <Input
            id={`${idPrefix}-year`}
            inputMode="numeric"
            {...register("year", {
              validate: (value) => {
                if (!value.trim()) return true;
                const year = parseOptionalVehicleNumber(value);
                if (year == null || !Number.isInteger(year) || year < 1886 || year > 2200) {
                  return t("vehicles.validation.yearRange");
                }
                return true;
              },
            })}
            placeholder={t("vehicles.placeholders.year")}
            disabled={disabled}
          />
          {errors.year && <p className="text-xs text-destructive">{errors.year.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-plate`}>{t("vehicles.fields.licensePlate")}</Label>
          <Input
            id={`${idPrefix}-plate`}
            {...register("licensePlate", {
              setValueAs: (value: string) => value.trim().toUpperCase(),
            })}
            placeholder={t("vehicles.placeholders.licensePlate")}
            autoCapitalize="characters"
            spellCheck={false}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-vin`}>{t("vehicles.fields.vin")}</Label>
        <Input
          id={`${idPrefix}-vin`}
          {...register("vin", {
            setValueAs: (value: string) => value.trim().toUpperCase(),
            validate: (value) => optionalVinValidate(value, t("vehicles.validation.vinInvalid")),
          })}
          placeholder={t("vehicles.placeholders.vin")}
          maxLength={17}
          autoCapitalize="characters"
          spellCheck={false}
          className={errors.vin ? "border-destructive" : ""}
          disabled={disabled}
        />
        {errors.vin && <p className="text-xs text-destructive">{errors.vin.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-mileage-unit`}>{t("vehicles.fields.mileageUnit")}</Label>
        <Select
          // Keep controlled: unset uses a non-selectable sentinel so Radix shows the placeholder.
          value={mileageUnit || unitUnset}
          onValueChange={(value) => {
            if (value !== "km" && value !== "mi") return;
            setValue("mileageUnit", value, { shouldDirty: true, shouldValidate: true });
          }}
          disabled={disabled}
        >
          <SelectTrigger id={`${idPrefix}-mileage-unit`} className="w-full min-w-0">
            <SelectValue placeholder={t("vehicles.placeholders.mileageUnit")} />
          </SelectTrigger>
          <SelectContent>
            {/* Hidden: keeps value controlled when unset; not a user-facing third option. */}
            <SelectItem value={unitUnset} disabled className="hidden">
              {t("vehicles.placeholders.mileageUnit")}
            </SelectItem>
            {MILEAGE_UNITS.map((unit) => (
              <SelectItem key={unit} value={unit}>
                {unit === "km" ? t("vehicles.mileage.kilometers") : t("vehicles.mileage.miles")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("vehicles.mileage.unitHint")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-initial-mileage`}>
            {t("vehicles.fields.initialMileage")}
            {unitAbbr ? <span className="ml-1 font-normal text-muted-foreground">({unitAbbr})</span> : null}
          </Label>
          <Input
            id={`${idPrefix}-initial-mileage`}
            inputMode="numeric"
            {...register("initialMileage", {
              validate: (value) => {
                if (!value.trim()) return true;
                const n = parseOptionalVehicleNumber(value);
                return (n != null && n >= 0) || t("vehicles.validation.mileageNonNegative");
              },
            })}
            placeholder={t("vehicles.placeholders.initialMileage")}
            disabled={disabled}
          />
          {errors.initialMileage && <p className="text-xs text-destructive">{errors.initialMileage.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-current-mileage`}>
            {t("vehicles.fields.currentMileage")}
            {unitAbbr ? <span className="ml-1 font-normal text-muted-foreground">({unitAbbr})</span> : null}
          </Label>
          <Input
            id={`${idPrefix}-current-mileage`}
            inputMode="numeric"
            {...register("currentMileage", {
              validate: (value) => {
                if (!value.trim()) return true;
                const n = parseOptionalVehicleNumber(value);
                return (n != null && n >= 0) || t("vehicles.validation.mileageNonNegative");
              },
            })}
            placeholder={t("vehicles.placeholders.currentMileage")}
            disabled={disabled}
          />
          {errors.currentMileage && <p className="text-xs text-destructive">{errors.currentMileage.message}</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-displacement`}>{t("vehicles.fields.engineDisplacement")}</Label>
          <Input
            id={`${idPrefix}-displacement`}
            inputMode="decimal"
            {...register("engineDisplacement", {
              validate: (value) => {
                if (!value.trim()) return true;
                const n = parseOptionalVehicleNumber(value);
                return (n != null && n > 0) || t("vehicles.validation.displacementPositive");
              },
            })}
            placeholder={t("vehicles.placeholders.engineDisplacement")}
            disabled={disabled}
          />
          {errors.engineDisplacement && <p className="text-xs text-destructive">{errors.engineDisplacement.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-fuel`}>{t("vehicles.fields.fuelType")}</Label>
          <Select value={fuelType || fuelNone} onValueChange={(value) => setValue("fuelType", value === fuelNone ? "" : value)} disabled={disabled}>
            <SelectTrigger id={`${idPrefix}-fuel`} className="w-full min-w-0">
              <SelectValue placeholder={t("vehicles.placeholders.fuelType")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={fuelNone}>{t("vehicles.placeholders.fuelTypeNone")}</SelectItem>
              {VEHICLE_FUEL_TYPES.map((fuel) => (
                <SelectItem key={fuel} value={fuel}>
                  {t(`vehicles.fuel.${fuel}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
