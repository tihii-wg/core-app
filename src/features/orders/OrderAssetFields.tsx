import type { ReactNode } from "react";
import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { orderAssetFieldRules, type industryOrderCopy, type IndustryWorkflow } from "../industries/industryWorkflow";
import type { OrderFieldConfigItem } from "./orderFieldConfig";

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
  /**
   * Hide visible device/plate/VIN inputs (e.g. when an order vehicle is selected).
   * Values stay registered as hidden inputs when preserveHiddenValues is true.
   */
  hideVisibleFields?: boolean;
  /** Workspace order-field config (label / visible / required overrides). */
  fieldConfig?: Map<string, OrderFieldConfigItem>;
};

export default function OrderAssetFields<T extends AssetFields>({
  register,
  errors,
  workflow,
  copy,
  idPrefix = "",
  disabled = false,
  preserveHiddenValues = false,
  hideVisibleFields = false,
  fieldConfig,
}: OrderAssetFieldsProps<T>) {
  const deviceId = `${idPrefix}device`;
  const carNumberId = `${idPrefix}carNumber`;
  const vinId = `${idPrefix}vin`;
  const { device, carNumber, vin } = workflow.orderFields;

  const deviceCfg = fieldConfig?.get("device");
  const carCfg = fieldConfig?.get("carNumber");
  const vinCfg = fieldConfig?.get("vin");

  const deviceVisible = deviceCfg ? deviceCfg.visible : device.visible;
  const carVisible = carCfg ? carCfg.visible : carNumber.visible;
  const vinVisible = vinCfg ? vinCfg.visible : vin.visible;

  const showDevice = deviceVisible && !hideVisibleFields;
  const showCarNumber = carVisible && !hideVisibleFields;
  const showVin = vinVisible && !hideVisibleFields;
  const keepHidden = preserveHiddenValues || hideVisibleFields;

  const deviceRules = orderAssetFieldRules(
    { ...device, visible: deviceVisible, required: deviceCfg?.required ?? device.required },
    { required: copy.deviceRequired },
  );
  const carRules = orderAssetFieldRules(
    { ...carNumber, visible: carVisible, required: carCfg?.required ?? carNumber.required },
    { required: copy.carNumberRequired },
  );
  const vinRules = orderAssetFieldRules(
    { ...vin, visible: vinVisible, required: vinCfg?.required ?? vin.required },
    { required: copy.vinRequired, length: copy.vinLength },
  );

  const ordered: Array<"device" | "carNumber" | "vin"> = ["device", "carNumber", "vin"].sort((a, b) => {
    const ao = fieldConfig?.get(a)?.sortOrder ?? (a === "device" ? 20 : a === "carNumber" ? 30 : 40);
    const bo = fieldConfig?.get(b)?.sortOrder ?? (b === "device" ? 20 : b === "carNumber" ? 30 : 40);
    return ao - bo;
  }) as Array<"device" | "carNumber" | "vin">;

  const nodes: Record<"device" | "carNumber" | "vin", ReactNode> = {
    device: showDevice ? (
      <div key="device" className="space-y-1.5" data-edit-field="device">
        <Label htmlFor={deviceId}>{deviceCfg?.label ?? copy.deviceLabel}</Label>
        <Input
          id={deviceId}
          {...register("device" as never, deviceRules as never)}
          placeholder={copy.devicePlaceholder}
          className={errors.device ? "border-destructive" : ""}
          disabled={disabled}
        />
        {errors.device && <p className="text-xs text-destructive">{errors.device.message}</p>}
      </div>
    ) : keepHidden && (deviceVisible || preserveHiddenValues) ? (
      <input key="device-hidden" type="hidden" {...register("device" as never)} />
    ) : null,
    carNumber: showCarNumber ? (
      <div key="carNumber" className="space-y-1.5" data-edit-field="carNumber">
        <Label htmlFor={carNumberId}>{carCfg?.label ?? copy.carNumberLabel}</Label>
        <Input
          id={carNumberId}
          {...register(
            "carNumber" as never,
            {
              ...carRules,
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
    ) : keepHidden && (carVisible || preserveHiddenValues) ? (
      <input key="carNumber-hidden" type="hidden" {...register("carNumber" as never)} />
    ) : null,
    vin: showVin ? (
      <div key="vin" className="space-y-1.5" data-edit-field="vin">
        <Label htmlFor={vinId}>{vinCfg?.label ?? copy.vinLabel}</Label>
        <Input
          id={vinId}
          {...register(
            "vin" as never,
            {
              ...vinRules,
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
    ) : keepHidden && (vinVisible || preserveHiddenValues) ? (
      <input key="vin-hidden" type="hidden" {...register("vin" as never)} />
    ) : null,
  };

  return <>{ordered.map((key) => nodes[key])}</>;
}
