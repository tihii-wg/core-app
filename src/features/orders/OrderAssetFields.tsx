import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { orderAssetFieldRules, type industryOrderCopy, type IndustryWorkflow } from "../industries/industryWorkflow";

type AssetFields = {
  device: string;
  carNumber: string;
  vin: string;
};

type OrderAssetFieldsProps<T extends AssetFields> = {
  register: UseFormRegister<T>;
  errors: FieldErrors<AssetFields>;
  workflow: IndustryWorkflow;
  copy: ReturnType<typeof industryOrderCopy>;
  idPrefix?: string;
  disabled?: boolean;
  /** Keep hidden fields registered so edit submits preserve stored values. */
  preserveHiddenValues?: boolean;
};

export default function OrderAssetFields<T extends AssetFields>({
  register,
  errors,
  workflow,
  copy,
  idPrefix = "",
  disabled = false,
  preserveHiddenValues = false,
}: OrderAssetFieldsProps<T>) {
  const deviceId = `${idPrefix}device`;
  const carNumberId = `${idPrefix}carNumber`;
  const vinId = `${idPrefix}vin`;
  const { device, carNumber, vin } = workflow.orderFields;

  return (
    <>
      {device.visible ? (
        <div className="space-y-1.5">
          <Label htmlFor={deviceId}>{copy.deviceLabel}</Label>
          <Input
            id={deviceId}
            {...register("device" as never, orderAssetFieldRules(device, { required: copy.deviceRequired }) as never)}
            placeholder={copy.devicePlaceholder}
            className={errors.device ? "border-destructive" : ""}
            disabled={disabled}
          />
          {errors.device && <p className="text-xs text-destructive">{errors.device.message}</p>}
        </div>
      ) : preserveHiddenValues ? (
        <input type="hidden" {...register("device" as never)} />
      ) : null}

      {carNumber.visible ? (
        <div className="space-y-1.5">
          <Label htmlFor={carNumberId}>{copy.carNumberLabel}</Label>
          <Input
            id={carNumberId}
            {...register(
              "carNumber" as never,
              {
                ...orderAssetFieldRules(carNumber, { required: copy.carNumberRequired }),
                setValueAs: (value: string) => value.trim().toUpperCase(),
              } as never,
            )}
            placeholder={copy.carNumberPlaceholder}
            autoCapitalize="characters"
            spellCheck={false}
            className={errors.carNumber ? "border-destructive" : ""}
            disabled={disabled}
          />
          {errors.carNumber && <p className="text-xs text-destructive">{errors.carNumber.message}</p>}
        </div>
      ) : preserveHiddenValues ? (
        <input type="hidden" {...register("carNumber" as never)} />
      ) : null}

      {vin.visible ? (
        <div className="space-y-1.5">
          <Label htmlFor={vinId}>{copy.vinLabel}</Label>
          <Input
            id={vinId}
            {...register(
              "vin" as never,
              {
                ...orderAssetFieldRules(vin, { required: copy.vinRequired, length: copy.vinLength }),
                setValueAs: (value: string) => value.trim().toUpperCase(),
              } as never,
            )}
            placeholder={copy.vinPlaceholder}
            maxLength={vin.exactLength ?? undefined}
            autoCapitalize="characters"
            spellCheck={false}
            className={errors.vin ? "border-destructive" : ""}
            disabled={disabled}
          />
          {errors.vin && <p className="text-xs text-destructive">{errors.vin.message}</p>}
        </div>
      ) : preserveHiddenValues ? (
        <input type="hidden" {...register("vin" as never)} />
      ) : null}
    </>
  );
}
