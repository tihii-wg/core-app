import { useTranslation } from "react-i18next";
import type { MileageUnit } from "../../lib/types";
import { cn } from "../../lib/utils";
import { mileageUnitAbbreviation } from "../vehicles/vehicleMileage";
import { formatWarrantyEndsOn, formatWarrantyKm } from "./OrderWarrantyIndicator";
import {
  formatWarrantyLimitsLabel,
  hasWarrantyCoverage,
  type WarrantyLimits,
  type WarrantyStatusCode,
} from "./warranty";

type Props = {
  limits: WarrantyLimits | null | undefined;
  /** When true, values come from an activated warranty_records snapshot. */
  activated?: boolean;
  /** Unit for mileage limit display (order or snapshot unit). */
  mileageUnit?: MileageUnit;
  /** When false, omit km from coverage label (non-vehicle industries). */
  showWarrantyKm?: boolean;
  /** Live evaluation status (e.g. paused while source order is not closed). */
  status?: WarrantyStatusCode | null;
  /** Snapshot start date (ISO); used for paused copy. */
  startsAt?: string | null;
  className?: string;
};

/** Compact per-line warranty chip. Renders nothing when the line has no coverage. */
export function OrderLineWarrantyBadge({
  limits,
  activated = false,
  mileageUnit = "km",
  showWarrantyKm = true,
  status = null,
  startsAt = null,
  className,
}: Props) {
  const { t, i18n } = useTranslation();
  if (!limits || !hasWarrantyCoverage(limits, { includeMileage: showWarrantyKm })) return null;

  const unit = mileageUnitAbbreviation(mileageUnit, t);
  const label = formatWarrantyLimitsLabel(
    limits,
    (key, options) => String(t(key, { ...options, unit } as never)),
    (n) => formatWarrantyKm(n, i18n.language || "en"),
    mileageUnit,
    showWarrantyKm,
  );
  if (!label) return null;

  const paused = status === "paused";
  const startDateLabel = formatWarrantyEndsOn(startsAt?.slice(0, 10) ?? null);
  const pausedText = startDateLabel
    ? t("orders.warranty.pausedSinceClose", { date: startDateLabel })
    : t("orders.warranty.status.paused");

  return (
    <p
      className={cn(
        "max-w-full text-[11px] leading-snug [overflow-wrap:anywhere]",
        paused
          ? "font-medium text-amber-700 dark:text-amber-400"
          : activated
            ? "font-medium text-foreground"
            : "text-muted-foreground",
        className,
      )}
      data-warranty-line
      data-warranty-activated={activated ? "true" : undefined}
      data-warranty-status={status ?? undefined}
      title={
        paused
          ? pausedText
          : activated
            ? t("orders.warranty.line.activatedHint")
            : t("orders.warranty.line.configuredHint")
      }
    >
      {paused ? pausedText : label}
    </p>
  );
}
