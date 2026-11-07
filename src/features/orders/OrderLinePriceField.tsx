import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { roundMoney } from "./orderTotals";

type OrderLinePriceFieldProps = {
  id: string;
  value: number | "" | null | undefined;
  /** Live catalog default for hint/reset; omit/null when not from catalog. */
  catalogPrice?: number | null;
  disabled?: boolean;
  errorMessage?: string | null;
  formatMoney: (value: number) => string;
  onChange: (price: number | "") => void;
  /** Hide the label (e.g. when stacked under an existing “Price” caption). */
  hideLabel?: boolean;
};

function pricesDiffer(a: number, b: number) {
  return Math.abs(roundMoney(a) - roundMoney(b)) > 0.0001;
}

/**
 * Editable unit price for an order service or catalog material line.
 * Catalog price is only a default: hint + reset when the line price diverges.
 */
export default function OrderLinePriceField({
  id,
  value,
  catalogPrice,
  disabled = false,
  errorMessage,
  formatMoney,
  onChange,
  hideLabel = false,
}: OrderLinePriceFieldProps) {
  const { t } = useTranslation();
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : null;
  const catalog =
    typeof catalogPrice === "number" && Number.isFinite(catalogPrice) ? catalogPrice : null;
  const showCatalogHint = catalog != null && numeric != null && pricesDiffer(numeric, catalog);

  return (
    <div className="space-y-1">
      {!hideLabel ? (
        <Label htmlFor={id} className="text-xs">
          {t("orders.form.linePrice")}
        </Label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          disabled={disabled}
          aria-label={t("orders.form.linePrice")}
          className={`h-8 w-28 tabular-nums ${errorMessage ? "border-destructive" : ""}`}
          value={value === "" || value == null ? "" : value}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === "") {
              onChange("");
              return;
            }
            const asNumber = Number(raw);
            onChange(Number.isFinite(asNumber) ? asNumber : "");
          }}
        />
        {showCatalogHint ? (
          <>
            <span className="text-[12px] text-muted-foreground tabular-nums">
              {t("orders.form.catalogPriceHint", { price: formatMoney(catalog) })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7"
              disabled={disabled}
              title={t("orders.form.resetToCatalogPrice")}
              aria-label={t("orders.form.resetToCatalogPrice")}
              onClick={() => onChange(catalog)}
            >
              <RotateCcw className="size-3.5" />
            </Button>
          </>
        ) : null}
      </div>
      {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}
    </div>
  );
}
