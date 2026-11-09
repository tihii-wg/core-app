import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { currentIntlLocale } from "../../i18n";
import { formatMileageInput, parseMileageInput } from "../../lib/mileage";
import type { MileageUnit } from "../../lib/types";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { MileageInput } from "../../ui/MileageInput";
import { mileageUnitAbbreviation } from "../vehicles/vehicleMileage";
import { normalizeWarrantyKm, normalizeWarrantyMonths, normalizeWarrantyDays } from "./warranty";

type Props = {
  months: number | null | undefined;
  days?: number | null | undefined;
  km: number | null | undefined;
  /** Order mileage unit for the warranty km field label. */
  mileageUnit?: MileageUnit;
  /** When false, hide km input and use duration-only hint (non-vehicle industries). */
  showWarrantyKm?: boolean;
  disabled?: boolean;
  idPrefix: string;
  onChange: (next: { warrantyMonths: number | null; warrantyDays: number | null; warrantyKm: number | null }) => void;
};

/**
 * Per-line warranty editors: months and/or exact days, plus optional mileage.
 * Duration and mileage are independent; when both are set, the first limit reached ends coverage.
 * Mileage values are in the order's unit (not catalog km).
 */
export default function OrderLineWarrantyFields({
  months,
  days,
  km,
  mileageUnit = "km",
  showWarrantyKm = true,
  disabled,
  idPrefix,
  onChange,
}: Props) {
  const { t } = useTranslation();
  const locale = currentIntlLocale();
  const hasDuration = (months != null && months > 0) || (days != null && days > 0);
  const hasMileage = showWarrantyKm && km != null && km > 0;
  const unitAbbr = mileageUnitAbbreviation(mileageUnit, t);

  const [kmText, setKmText] = useState(() => (km != null ? formatMileageInput(km, locale) : ""));
  const kmFocused = useRef(false);

  useEffect(() => {
    if (kmFocused.current) return;
    setKmText(km != null ? formatMileageInput(km, locale) : "");
  }, [km, locale]);

  function commitKm(raw: string) {
    let next: number | null = null;
    try {
      const parsed = parseMileageInput(raw);
      next = parsed != null && parsed > 0 ? parsed : null;
    } catch {
      next = null;
    }
    onChange({
      warrantyMonths: months ?? null,
      warrantyDays: days ?? null,
      warrantyKm: next,
    });
    setKmText(next != null ? formatMileageInput(next, locale) : raw.trim() === "" ? "" : raw);
  }

  return (
    <div className="mt-2 space-y-2">
      <div className={`grid gap-2 ${showWarrantyKm ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`}>
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
        {showWarrantyKm ? (
          <div className="space-y-1 col-span-2 sm:col-span-1">
            <Label htmlFor={`${idPrefix}-warranty-km`} className="text-xs text-muted-foreground">
              {t("orders.warranty.kmLabel", { unit: unitAbbr })}
            </Label>
            <MileageInput
              id={`${idPrefix}-warranty-km`}
              disabled={disabled}
              value={kmText}
              placeholder={t("orders.warranty.noLimit")}
              onFocus={() => {
                kmFocused.current = true;
              }}
              onChange={(event) => {
                setKmText(event.target.value);
                const soft = normalizeWarrantyKm(event.target.value);
                if (soft !== (km ?? null) && (soft != null || event.target.value.trim() === "")) {
                  onChange({
                    warrantyMonths: months ?? null,
                    warrantyDays: days ?? null,
                    warrantyKm: soft,
                  });
                }
              }}
              onBlur={() => {
                kmFocused.current = false;
                commitKm(kmText);
              }}
            />
          </div>
        ) : null}
      </div>
      {showWarrantyKm && hasDuration && hasMileage ? (
        <p className="text-[11px] text-muted-foreground" data-warranty-whichever-first>
          {t("orders.warranty.whicheverFirst")}
        </p>
      ) : !showWarrantyKm && hasDuration ? (
        <p className="text-[11px] text-muted-foreground" data-warranty-duration-only>
          {t("orders.warranty.durationOnlyHint")}
        </p>
      ) : null}
    </div>
  );
}
