import { useTranslation } from "react-i18next";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";

type Props = {
  months: number | null | undefined;
  km: number | null | undefined;
  disabled?: boolean;
  idPrefix: string;
  onChange: (next: { warrantyMonths: number | null; warrantyKm: number | null }) => void;
};

function parseOptional(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/** Compact per-line warranty duration (months) + mileage limit editors. */
export default function OrderLineWarrantyFields({ months, km, disabled, idPrefix, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
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
          onChange={(event) => onChange({ warrantyMonths: parseOptional(event.target.value), warrantyKm: km ?? null })}
        />
      </div>
      <div className="space-y-1">
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
          onChange={(event) => onChange({ warrantyMonths: months ?? null, warrantyKm: parseOptional(event.target.value) })}
        />
      </div>
    </div>
  );
}
