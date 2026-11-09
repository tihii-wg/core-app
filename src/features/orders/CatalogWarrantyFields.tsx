import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { currentIntlLocale } from "../../i18n";
import { formatMileageInput, parseMileageInput } from "../../lib/mileage";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { MileageInput } from "../../ui/MileageInput";
import { Switch } from "../../ui/Switch";
import {
  catalogWarrantyShowsKm,
  catalogWarrantyShowsMonths,
  type CatalogWarrantyDefaults,
  type CatalogWarrantyType,
} from "./catalogWarranty";
import { normalizeWarrantyKm, normalizeWarrantyMonths } from "./warranty";

type Props = {
  value: CatalogWarrantyDefaults;
  onChange: (next: CatalogWarrantyDefaults) => void;
  idPrefix: string;
  disabled?: boolean;
  error?: string | null;
  /** When false, hide mileage UI and preserve any stored warrantyKm (non-vehicle industries). */
  showWarrantyKm?: boolean;
};

function deriveType(durationEnabled: boolean, mileageEnabled: boolean): CatalogWarrantyType {
  if (durationEnabled && mileageEnabled) return "both";
  if (durationEnabled) return "duration";
  if (mileageEnabled) return "mileage";
  return "none";
}

/**
 * Catalog-card warranty defaults editor.
 * Duration and mileage are independent toggles; both can apply at once (first limit wins).
 */
export default function CatalogWarrantyFields({
  value,
  onChange,
  idPrefix,
  disabled,
  error,
  showWarrantyKm = true,
}: Props) {
  const { t } = useTranslation();
  const locale = currentIntlLocale();
  const type = value.warrantyType ?? "none";
  const durationEnabled = catalogWarrantyShowsMonths(type);
  const mileageEnabled = showWarrantyKm && catalogWarrantyShowsKm(type);
  const bothEnabled = durationEnabled && mileageEnabled;
  const storedKm = value.warrantyKm;

  const [kmText, setKmText] = useState(() =>
    value.warrantyKm != null ? formatMileageInput(value.warrantyKm, locale) : "",
  );
  const kmFocused = useRef(false);

  useEffect(() => {
    if (kmFocused.current) return;
    setKmText(value.warrantyKm != null ? formatMileageInput(value.warrantyKm, locale) : "");
  }, [value.warrantyKm, locale]);

  function emit(nextDuration: boolean, nextMileage: boolean, months: number | null, km: number | null) {
    if (!showWarrantyKm) {
      // Duration-only UI: never clear or invent mileage — preserve stored km/type aspect.
      const hasKm = storedKm != null && storedKm > 0;
      if (!nextDuration && !hasKm) {
        onChange({ warrantyType: "none", warrantyMonths: null, warrantyKm: storedKm });
        return;
      }
      if (!nextDuration && hasKm) {
        onChange({ warrantyType: "mileage", warrantyMonths: null, warrantyKm: storedKm });
        return;
      }
      onChange({
        warrantyType: hasKm ? "both" : "duration",
        warrantyMonths: months,
        warrantyKm: storedKm,
      });
      return;
    }

    const nextType = deriveType(nextDuration, nextMileage);
    if (nextType === "none") {
      onChange({ warrantyType: "none", warrantyMonths: null, warrantyKm: null });
      return;
    }
    onChange({
      warrantyType: nextType,
      warrantyMonths: nextDuration ? months : null,
      warrantyKm: nextMileage ? km : null,
    });
  }

  function commitKm(raw: string) {
    let next: number | null = null;
    try {
      const parsed = parseMileageInput(raw);
      next = parsed != null && parsed > 0 ? parsed : null;
    } catch {
      next = null;
    }
    emit(durationEnabled, true, value.warrantyMonths, next);
    setKmText(next != null ? formatMileageInput(next, locale) : raw.trim() === "" ? "" : raw);
  }

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="space-y-1">
        <Label className="text-sm font-medium">{t("catalogWarranty.sectionTitle")}</Label>
        <p className="text-xs text-muted-foreground">
          {showWarrantyKm ? t("catalogWarranty.sectionHint") : t("catalogWarranty.sectionHintDurationOnly")}
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${idPrefix}-warranty-duration-enabled`} className="text-sm font-normal">
            {t("catalogWarranty.enableDuration")}
          </Label>
          <Switch
            id={`${idPrefix}-warranty-duration-enabled`}
            checked={durationEnabled}
            disabled={disabled}
            onCheckedChange={(checked) => emit(checked, mileageEnabled, value.warrantyMonths, value.warrantyKm)}
          />
        </div>
        {durationEnabled ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-warranty-months`}>{t("catalogWarranty.monthsLabel")}</Label>
            <Input
              id={`${idPrefix}-warranty-months`}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              disabled={disabled}
              value={value.warrantyMonths ?? ""}
              placeholder={t("catalogWarranty.monthsPlaceholder")}
              onChange={(event) =>
                emit(true, mileageEnabled, normalizeWarrantyMonths(event.target.value), value.warrantyKm)
              }
            />
          </div>
        ) : null}

        {showWarrantyKm ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={`${idPrefix}-warranty-mileage-enabled`} className="text-sm font-normal">
                {t("catalogWarranty.enableMileage")}
              </Label>
              <Switch
                id={`${idPrefix}-warranty-mileage-enabled`}
                checked={mileageEnabled}
                disabled={disabled}
                onCheckedChange={(checked) => emit(durationEnabled, checked, value.warrantyMonths, value.warrantyKm)}
              />
            </div>
            {mileageEnabled ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-warranty-km`}>{t("catalogWarranty.kmLabel")}</Label>
                <MileageInput
                  id={`${idPrefix}-warranty-km`}
                  disabled={disabled}
                  value={kmText}
                  placeholder={t("catalogWarranty.kmPlaceholder")}
                  onFocus={() => {
                    kmFocused.current = true;
                  }}
                  onChange={(event) => {
                    setKmText(event.target.value);
                    const soft = normalizeWarrantyKm(event.target.value);
                    if (soft !== (value.warrantyKm ?? null) && (soft != null || event.target.value.trim() === "")) {
                      emit(durationEnabled, true, value.warrantyMonths, soft);
                    }
                  }}
                  onBlur={() => {
                    kmFocused.current = false;
                    commitKm(kmText);
                  }}
                />
                <p className="text-xs text-muted-foreground">{t("catalogWarranty.kmOrderHint")}</p>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {bothEnabled ? (
        <p className="text-xs text-muted-foreground" data-warranty-whichever-first>
          {t("catalogWarranty.whicheverFirst")}
        </p>
      ) : !showWarrantyKm && durationEnabled ? (
        <p className="text-xs text-muted-foreground" data-warranty-duration-only>
          {t("catalogWarranty.durationOnlyHint")}
        </p>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
