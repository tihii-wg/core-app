import { useState } from "react";
import type { FieldErrors, UseFormRegister, UseFormSetValue } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Textarea } from "../../ui/Textarea";
import type { IndustryOrderFieldBlocks } from "../industries/industryProfile";
import { hasVisibleIndustryOrderFields, type OrderIndustryFormFields } from "./industryOrderFieldHelpers";
import type { OrderFieldConfigItem } from "./orderFieldConfig";

type OrderIndustryFieldsProps<T extends OrderIndustryFormFields> = {
  register: UseFormRegister<T>;
  setValue: UseFormSetValue<T>;
  errors: FieldErrors<OrderIndustryFormFields>;
  blocks: IndustryOrderFieldBlocks;
  /** Client address used by the «Адрес клиента» prefill button. */
  clientAddress?: string | null;
  idPrefix?: string;
  disabled?: boolean;
  /** Workspace order-field config (label / visible / required overrides). */
  fieldConfig?: Map<string, OrderFieldConfigItem>;
};

function cfgVisible(fieldConfig: Map<string, OrderFieldConfigItem> | undefined, key: string, industryDefault: boolean) {
  if (!industryDefault) return false;
  const cfg = fieldConfig?.get(key);
  return cfg ? cfg.visible : true;
}

function cfgLabel(fieldConfig: Map<string, OrderFieldConfigItem> | undefined, key: string, fallback: string) {
  return fieldConfig?.get(key)?.label ?? fallback;
}

function cfgRequired(fieldConfig: Map<string, OrderFieldConfigItem> | undefined, key: string) {
  return Boolean(fieldConfig?.get(key)?.required);
}

/**
 * Compact industry-specific intake block shown under the object / device fields.
 * Visibility comes from `orderFieldBlocks` plus workspace field config overrides.
 */
export default function OrderIndustryFields<T extends OrderIndustryFormFields>({
  register,
  setValue,
  errors,
  blocks,
  clientAddress,
  idPrefix = "",
  disabled = false,
  fieldConfig,
}: OrderIndustryFieldsProps<T>) {
  const { t } = useTranslation();
  const [showPasscode, setShowPasscode] = useState(false);

  const showSerial = cfgVisible(fieldConfig, "deviceSerial", blocks.deviceSerial);
  const showImei = cfgVisible(fieldConfig, "deviceImei", blocks.deviceImei);
  const showCondition = cfgVisible(fieldConfig, "deviceCondition", blocks.deviceCondition);
  const showCompleteness = cfgVisible(fieldConfig, "deviceCompleteness", blocks.deviceCompleteness);
  const showPasscodeField = cfgVisible(fieldConfig, "devicePasscode", blocks.devicePasscode);
  const showSite = cfgVisible(fieldConfig, "siteAddress", blocks.siteAddress);
  const showDimensions = cfgVisible(fieldConfig, "productDimensions", blocks.productDimensions);
  const showMeasurement = cfgVisible(fieldConfig, "measurementAt", blocks.measurementAt);
  const showInstallation = cfgVisible(fieldConfig, "installationAt", blocks.installationAt);

  if (
    !showSerial &&
    !showImei &&
    !showCondition &&
    !showCompleteness &&
    !showPasscodeField &&
    !showSite &&
    !showDimensions &&
    !showMeasurement &&
    !showInstallation &&
    !hasVisibleIndustryOrderFields(blocks)
  ) {
    return null;
  }
  if (
    !showSerial &&
    !showImei &&
    !showCondition &&
    !showCompleteness &&
    !showPasscodeField &&
    !showSite &&
    !showDimensions &&
    !showMeasurement &&
    !showInstallation
  ) {
    return null;
  }

  const serialId = `${idPrefix}deviceSerial`;
  const imeiId = `${idPrefix}deviceImei`;
  const conditionId = `${idPrefix}deviceCondition`;
  const completenessId = `${idPrefix}deviceCompleteness`;
  const passcodeId = `${idPrefix}devicePasscode`;
  const siteId = `${idPrefix}siteAddress`;
  const dimensionsId = `${idPrefix}productDimensions`;
  const measureDateId = `${idPrefix}measurementDate`;
  const measureTimeId = `${idPrefix}measurementTime`;
  const installDateId = `${idPrefix}installationDate`;
  const installTimeId = `${idPrefix}installationTime`;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="order-industry-fields">
      {showSerial ? (
        <div className="space-y-1.5" data-edit-field="deviceSerial">
          <Label htmlFor={serialId}>
            {cfgLabel(fieldConfig, "deviceSerial", t("orders.industryFields.deviceSerial"))}
            {cfgRequired(fieldConfig, "deviceSerial") ? <span className="text-destructive"> *</span> : null}
          </Label>
          <Input
            id={serialId}
            {...register("deviceSerial" as never, cfgRequired(fieldConfig, "deviceSerial") ? { required: t("settings.orderFields.validation.required") } : undefined)}
            disabled={disabled}
            autoComplete="off"
          />
        </div>
      ) : null}

      {showImei ? (
        <div className="space-y-1.5" data-edit-field="deviceImei">
          <Label htmlFor={imeiId}>
            {cfgLabel(fieldConfig, "deviceImei", t("orders.industryFields.deviceImei"))}
            {cfgRequired(fieldConfig, "deviceImei") ? <span className="text-destructive"> *</span> : null}
          </Label>
          <Input
            id={imeiId}
            {...register("deviceImei" as never, cfgRequired(fieldConfig, "deviceImei") ? { required: t("settings.orderFields.validation.required") } : undefined)}
            disabled={disabled}
            autoComplete="off"
            inputMode="numeric"
          />
        </div>
      ) : null}

      {showCondition ? (
        <div className="space-y-1.5 sm:col-span-2" data-edit-field="deviceCondition">
          <Label htmlFor={conditionId}>
            {cfgLabel(fieldConfig, "deviceCondition", t("orders.industryFields.deviceCondition"))}
            {cfgRequired(fieldConfig, "deviceCondition") ? <span className="text-destructive"> *</span> : null}
          </Label>
          <Textarea
            id={conditionId}
            {...register("deviceCondition" as never, cfgRequired(fieldConfig, "deviceCondition") ? { required: t("settings.orderFields.validation.required") } : undefined)}
            rows={2}
            disabled={disabled}
          />
        </div>
      ) : null}

      {showCompleteness ? (
        <div className="space-y-1.5 sm:col-span-2" data-edit-field="deviceCompleteness">
          <Label htmlFor={completenessId}>
            {cfgLabel(fieldConfig, "deviceCompleteness", t("orders.industryFields.deviceCompleteness"))}
            {cfgRequired(fieldConfig, "deviceCompleteness") ? <span className="text-destructive"> *</span> : null}
          </Label>
          <Textarea
            id={completenessId}
            {...register("deviceCompleteness" as never, cfgRequired(fieldConfig, "deviceCompleteness") ? { required: t("settings.orderFields.validation.required") } : undefined)}
            rows={2}
            disabled={disabled}
          />
        </div>
      ) : null}

      {showPasscodeField ? (
        <div className="space-y-1.5 sm:col-span-2" data-edit-field="devicePasscode">
          <Label htmlFor={passcodeId}>
            {cfgLabel(fieldConfig, "devicePasscode", t("orders.industryFields.devicePasscode"))}
            {cfgRequired(fieldConfig, "devicePasscode") ? <span className="text-destructive"> *</span> : null}
          </Label>
          <div className="flex gap-2">
            <Input
              id={passcodeId}
              type={showPasscode ? "text" : "password"}
              {...register("devicePasscode" as never, cfgRequired(fieldConfig, "devicePasscode") ? { required: t("settings.orderFields.validation.required") } : undefined)}
              disabled={disabled}
              autoComplete="off"
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={disabled}
              aria-label={showPasscode ? t("orders.industryFields.hidePasscode") : t("orders.industryFields.showPasscode")}
              aria-pressed={showPasscode}
              onClick={() => setShowPasscode((current) => !current)}
            >
              {showPasscode ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
        </div>
      ) : null}

      {showSite ? (
        <div className="space-y-1.5 sm:col-span-2" data-edit-field="siteAddress">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor={siteId}>
              {cfgLabel(fieldConfig, "siteAddress", t("orders.industryFields.siteAddress"))}
              {cfgRequired(fieldConfig, "siteAddress") ? <span className="text-destructive"> *</span> : null}
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || !clientAddress?.trim()}
              onClick={() => {
                const address = clientAddress?.trim();
                if (!address) return;
                setValue("siteAddress" as never, address as never, { shouldDirty: true, shouldTouch: true });
              }}
            >
              {t("orders.industryFields.useClientAddress")}
            </Button>
          </div>
          <Textarea
            id={siteId}
            {...register("siteAddress" as never, cfgRequired(fieldConfig, "siteAddress") ? { required: t("settings.orderFields.validation.required") } : undefined)}
            rows={2}
            disabled={disabled}
          />
        </div>
      ) : null}

      {showDimensions ? (
        <div className="space-y-1.5 sm:col-span-2" data-edit-field="productDimensions">
          <Label htmlFor={dimensionsId}>
            {cfgLabel(fieldConfig, "productDimensions", t("orders.industryFields.productDimensions"))}
            {cfgRequired(fieldConfig, "productDimensions") ? <span className="text-destructive"> *</span> : null}
          </Label>
          <Input
            id={dimensionsId}
            {...register("productDimensions" as never, cfgRequired(fieldConfig, "productDimensions") ? { required: t("settings.orderFields.validation.required") } : undefined)}
            placeholder={t("orders.industryFields.productDimensionsPlaceholder")}
            disabled={disabled}
          />
        </div>
      ) : null}

      {showMeasurement ? (
        <div className="space-y-1.5" data-edit-field="measurementAt">
          <Label htmlFor={measureDateId}>
            {cfgLabel(fieldConfig, "measurementAt", t("orders.industryFields.measurementAt"))}
            {cfgRequired(fieldConfig, "measurementAt") ? <span className="text-destructive"> *</span> : null}
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={measureDateId}
              type="date"
              {...register("measurementDate" as never)}
              disabled={disabled}
              className="min-w-0 flex-1"
            />
            <Input
              id={measureTimeId}
              type="time"
              {...register("measurementTime" as never)}
              disabled={disabled}
              className="min-w-0 flex-1"
              aria-label={t("orders.industryFields.measurementTime")}
            />
          </div>
        </div>
      ) : null}

      {showInstallation ? (
        <div className="space-y-1.5" data-edit-field="installationAt">
          <Label htmlFor={installDateId}>
            {cfgLabel(fieldConfig, "installationAt", t("orders.industryFields.installationAt"))}
            {cfgRequired(fieldConfig, "installationAt") ? <span className="text-destructive"> *</span> : null}
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={installDateId}
              type="date"
              {...register("installationDate" as never)}
              disabled={disabled}
              className="min-w-0 flex-1"
            />
            <Input
              id={installTimeId}
              type="time"
              {...register("installationTime" as never)}
              disabled={disabled}
              className="min-w-0 flex-1"
              aria-label={t("orders.industryFields.installationTime")}
            />
          </div>
          {errors.installationDate ? (
            <p className="text-xs text-destructive">{errors.installationDate.message}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
