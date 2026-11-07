import { useTranslation } from "react-i18next";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
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
export default function CatalogWarrantyFields({ value, onChange, idPrefix, disabled, error }: Props) {
  const { t } = useTranslation();
  const type = value.warrantyType ?? "none";
  const durationEnabled = catalogWarrantyShowsMonths(type);
  const mileageEnabled = catalogWarrantyShowsKm(type);
  const bothEnabled = durationEnabled && mileageEnabled;

  function emit(nextDuration: boolean, nextMileage: boolean, months: number | null, km: number | null) {
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

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="space-y-1">
        <Label className="text-sm font-medium">{t("catalogWarranty.sectionTitle")}</Label>
        <p className="text-xs text-muted-foreground">{t("catalogWarranty.sectionHint")}</p>
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
            <Input
              id={`${idPrefix}-warranty-km`}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              disabled={disabled}
              value={value.warrantyKm ?? ""}
              placeholder={t("catalogWarranty.kmPlaceholder")}
              onChange={(event) =>
                emit(durationEnabled, true, value.warrantyMonths, normalizeWarrantyKm(event.target.value))
              }
            />
            <p className="text-xs text-muted-foreground">{t("catalogWarranty.kmOrderHint")}</p>
          </div>
        ) : null}
      </div>

      {bothEnabled ? (
        <p className="text-xs text-muted-foreground" data-warranty-whichever-first>
          {t("catalogWarranty.whicheverFirst")}
        </p>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
