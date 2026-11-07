import { useTranslation } from "react-i18next";
import type { MileageUnit } from "../../lib/types";
import { cn } from "../../lib/utils";
import { mileageUnitAbbreviation } from "../vehicles/vehicleMileage";
import { formatWarrantyKm } from "./OrderWarrantyIndicator";
import {
  formatWarrantyLimitsLabel,
  hasWarrantyCoverage,
  type WarrantyLimits,
} from "./warranty";

type Props = {
  limits: WarrantyLimits | null | undefined;
  /** When true, values come from an activated warranty_records snapshot. */
  activated?: boolean;
  /** Unit for mileage limit display (order or snapshot unit). */
  mileageUnit?: MileageUnit;
  className?: string;
};

/** Compact per-line warranty chip. Renders nothing when the line has no coverage. */
export function OrderLineWarrantyBadge({ limits, activated = false, mileageUnit = "km", className }: Props) {
  const { t, i18n } = useTranslation();
  if (!limits || !hasWarrantyCoverage(limits)) return null;

  const unit = mileageUnitAbbreviation(mileageUnit, t);
  const label = formatWarrantyLimitsLabel(
    limits,
    (key, options) => String(t(key, { ...options, unit } as never)),
    (n) => formatWarrantyKm(n, i18n.language || "en"),
    mileageUnit,
  );
  if (!label) return null;

  return (
    <p
      className={cn(
        "max-w-full text-[11px] leading-snug [overflow-wrap:anywhere]",
        activated ? "font-medium text-foreground" : "text-muted-foreground",
        className,
      )}
      data-warranty-line
      data-warranty-activated={activated ? "true" : undefined}
      title={activated ? t("orders.warranty.line.activatedHint") : t("orders.warranty.line.configuredHint")}
    >
      {label}
    </p>
  );
}
