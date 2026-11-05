import { useTranslation } from "react-i18next";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import {
  catalogWarrantyShowsKm,
  catalogWarrantyShowsMonths,
  normalizeCatalogWarrantyType,
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

/**
 * Catalog-card warranty defaults editor.
 * Distinct from OrderLineWarrantyFields (order-item override / snapshot).
 */
export default function CatalogWarrantyFields({ value, onChange, idPrefix, disabled, error }: Props) {
  const { t } = useTranslation();
  const type = value.warrantyType ?? "none";

  function setType(nextType: CatalogWarrantyType) {
    if (nextType === "none") {
      onChange({ warrantyType: "none", warrantyMonths: null, warrantyKm: null });
      return;
    }
    if (nextType === "duration") {
      onChange({ warrantyType: "duration", warrantyMonths: value.warrantyMonths, warrantyKm: null });
      return;
    }
    if (nextType === "mileage") {
      onChange({ warrantyType: "mileage", warrantyMonths: null, warrantyKm: value.warrantyKm });
      return;
    }
    onChange({ warrantyType: "both", warrantyMonths: value.warrantyMonths, warrantyKm: value.warrantyKm });
  }

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="space-y-1">
        <Label className="text-sm font-medium">{t("catalogWarranty.sectionTitle")}</Label>
        <p className="text-xs text-muted-foreground">{t("catalogWarranty.sectionHint")}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-warranty-type`}>{t("catalogWarranty.typeLabel")}</Label>
        <Select
          value={type}
          disabled={disabled}
          onValueChange={(raw) => {
            const next = normalizeCatalogWarrantyType(raw) ?? "none";
            setType(next);
          }}
        >
          <SelectTrigger id={`${idPrefix}-warranty-type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("catalogWarranty.types.none")}</SelectItem>
            <SelectItem value="duration">{t("catalogWarranty.types.duration")}</SelectItem>
            <SelectItem value="mileage">{t("catalogWarranty.types.mileage")}</SelectItem>
            <SelectItem value="both">{t("catalogWarranty.types.both")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(catalogWarrantyShowsMonths(type) || catalogWarrantyShowsKm(type)) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {catalogWarrantyShowsMonths(type) && (
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
                  onChange({
                    ...value,
                    warrantyType: type,
                    warrantyMonths: normalizeWarrantyMonths(event.target.value),
                    warrantyKm: catalogWarrantyShowsKm(type) ? value.warrantyKm : null,
                  })
                }
              />
            </div>
          )}
          {catalogWarrantyShowsKm(type) && (
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
                  onChange({
                    ...value,
                    warrantyType: type,
                    warrantyKm: normalizeWarrantyKm(event.target.value),
                    warrantyMonths: catalogWarrantyShowsMonths(type) ? value.warrantyMonths : null,
                  })
                }
              />
            </div>
          )}
        </div>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
