import { useTranslation } from "react-i18next";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";

type Props = {
  months: number | null | undefined;
  days?: number | null | undefined;
  km: number | null | undefined;
  disabled?: boolean;
  idPrefix: string;
  onChange: (next: { warrantyMonths: number | null; warrantyDays: number | null; warrantyKm: number | null }) => void;
};

function parseOptional(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/**
 * Per-line warranty editors: months OR exact days (months take precedence when both set),
 * plus optional mileage. Workspace defaults typically fill months + km.
 */
export default function OrderLineWarrantyFields({ months, days, km, disabled, idPrefix, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
              warrantyMonths: parseOptional(event.target.value),
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
              warrantyDays: parseOptional(event.target.value),
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
              warrantyKm: parseOptional(event.target.value),
            })
          }
        />
      </div>
    </div>
  );
}
