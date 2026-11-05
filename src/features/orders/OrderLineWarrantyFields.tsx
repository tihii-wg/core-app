import { useTranslation } from "react-i18next";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { normalizeWarrantyKm, normalizeWarrantyMonths, normalizeWarrantyDays } from "./warranty";

type Props = {
  months: number | null | undefined;
  days?: number | null | undefined;
  km: number | null | undefined;
  disabled?: boolean;
  idPrefix: string;
  onChange: (next: { warrantyMonths: number | null; warrantyDays: number | null; warrantyKm: number | null }) => void;
};

/**
 * Per-line warranty editors: months and/or exact days, plus optional mileage.
 * Duration and mileage are independent; when both are set, the first limit reached ends coverage.
 */
export default function OrderLineWarrantyFields({ months, days, km, disabled, idPrefix, onChange }: Props) {
  const { t } = useTranslation();
  const hasDuration = (months != null && months > 0) || (days != null && days > 0);
  const hasMileage = km != null && km > 0;

  return (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-warranty-months`} className="text-xs text-muted-foreground">
            {t("orders.warranty.monthsLabel")}
          </Label>
          <Input
            id={`${idPrefix}-warranty-months`}
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            disabled={disabled}
            value={months ?? ""}
            placeholder={t("orders.warranty.noLimit")}
            onChange={(event) =>
              onChange({
                warrantyMonths: normalizeWarrantyMonths(event.target.value),
                warrantyDays: days ?? null,
                warrantyKm: km ?? null,
              })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-warranty-days`} className="text-xs text-muted-foreground">
            {t("orders.warranty.daysLabel")}
          </Label>
          <Input
            id={`${idPrefix}-warranty-days`}
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            disabled={disabled}
            value={days ?? ""}
            placeholder={t("orders.warranty.noLimit")}
            onChange={(event) =>
              onChange({
                warrantyMonths: months ?? null,
                warrantyDays: normalizeWarrantyDays(event.target.value),
                warrantyKm: km ?? null,
              })
            }
          />
        </div>
        <div className="space-y-1 col-span-2 sm:col-span-1">
          <Label htmlFor={`${idPrefix}-warranty-km`} className="text-xs text-muted-foreground">
            {t("orders.warranty.kmLabel")}
          </Label>
          <Input
            id={`${idPrefix}-warranty-km`}
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            disabled={disabled}
            value={km ?? ""}
            placeholder={t("orders.warranty.noLimit")}
            onChange={(event) =>
              onChange({
                warrantyMonths: months ?? null,
                warrantyDays: days ?? null,
                warrantyKm: normalizeWarrantyKm(event.target.value),
              })
            }
          />
        </div>
      </div>
      {hasDuration && hasMileage ? (
        <p className="text-[11px] text-muted-foreground" data-warranty-whichever-first>
          {t("orders.warranty.whicheverFirst")}
        </p>
      ) : null}
    </div>
  );
}
