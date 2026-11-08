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

type OrderIndustryFieldsProps<T extends OrderIndustryFormFields> = {
  register: UseFormRegister<T>;
  setValue: UseFormSetValue<T>;
  errors: FieldErrors<OrderIndustryFormFields>;
  blocks: IndustryOrderFieldBlocks;
  /** Client address used by the «Адрес клиента» prefill button. */
  clientAddress?: string | null;
  idPrefix?: string;
  disabled?: boolean;
};

/**
 * Compact industry-specific intake block shown under the object / device fields.
 * Visibility comes entirely from `orderFieldBlocks` (no slug checks).
 */
export default function OrderIndustryFields<T extends OrderIndustryFormFields>({
  register,
  setValue,
  errors,
  blocks,
  clientAddress,
  idPrefix = "",
  disabled = false,
}: OrderIndustryFieldsProps<T>) {
  const { t } = useTranslation();
  const [showPasscode, setShowPasscode] = useState(false);

  if (!hasVisibleIndustryOrderFields(blocks)) return null;

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
      {blocks.deviceSerial ? (
        <div className="space-y-1.5">
          <Label htmlFor={serialId}>{t("orders.industryFields.deviceSerial")}</Label>
          <Input id={serialId} {...register("deviceSerial" as never)} disabled={disabled} autoComplete="off" />
        </div>
      ) : null}

      {blocks.deviceImei ? (
        <div className="space-y-1.5">
          <Label htmlFor={imeiId}>{t("orders.industryFields.deviceImei")}</Label>
          <Input
            id={imeiId}
            {...register("deviceImei" as never)}
            disabled={disabled}
            autoComplete="off"
            inputMode="numeric"
          />
        </div>
      ) : null}

      {blocks.deviceCondition ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={conditionId}>{t("orders.industryFields.deviceCondition")}</Label>
          <Textarea id={conditionId} {...register("deviceCondition" as never)} rows={2} disabled={disabled} />
        </div>
      ) : null}

      {blocks.deviceCompleteness ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={completenessId}>{t("orders.industryFields.deviceCompleteness")}</Label>
          <Textarea id={completenessId} {...register("deviceCompleteness" as never)} rows={2} disabled={disabled} />
        </div>
      ) : null}

      {blocks.devicePasscode ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={passcodeId}>{t("orders.industryFields.devicePasscode")}</Label>
          <div className="flex gap-2">
            <Input
              id={passcodeId}
              type={showPasscode ? "text" : "password"}
              {...register("devicePasscode" as never)}
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

      {blocks.siteAddress ? (
        <div className="space-y-1.5 sm:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor={siteId}>{t("orders.industryFields.siteAddress")}</Label>
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
          <Textarea id={siteId} {...register("siteAddress" as never)} rows={2} disabled={disabled} />
        </div>
      ) : null}

      {blocks.productDimensions ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={dimensionsId}>{t("orders.industryFields.productDimensions")}</Label>
          <Input
            id={dimensionsId}
            {...register("productDimensions" as never)}
            placeholder={t("orders.industryFields.productDimensionsPlaceholder")}
            disabled={disabled}
          />
        </div>
      ) : null}

      {blocks.measurementAt ? (
        <div className="space-y-1.5">
          <Label htmlFor={measureDateId}>{t("orders.industryFields.measurementAt")}</Label>
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

      {blocks.installationAt ? (
        <div className="space-y-1.5">
          <Label htmlFor={installDateId}>{t("orders.industryFields.installationAt")}</Label>
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
