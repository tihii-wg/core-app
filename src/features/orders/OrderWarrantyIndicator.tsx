import { useTranslation } from "react-i18next";
import { formatMileageInput } from "../../lib/mileage";
import { cn } from "../../lib/utils";
import { mileageUnitAbbreviation } from "../vehicles/vehicleMileage";
import { isWarrantyExpired, snapshotMileageUnit, type OrderWarrantyIndicatorModel, type RemainingDuration } from "./warranty";

/** Format YYYY-MM-DD as DD.MM.YYYY (matches warranty indicator copy across locales). */
export function formatWarrantyEndsOn(endsOn: string | null | undefined): string | null {
  if (!endsOn?.trim()) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endsOn.trim());
  if (!match) return endsOn.trim();
  return `${match[3]}.${match[2]}.${match[1]}`;
}

export function formatWarrantyKm(value: number, language: string): string {
  return formatMileageInput(Math.max(0, Math.floor(value)), language || "en");
}

type TranslateFn = (key: string, options?: { count?: number; value?: string; date?: string; active?: number }) => string;

/** Compact remaining-time phrase from engine RemainingDuration (never negative). */
export function remainingDurationLabel(remaining: RemainingDuration, t: TranslateFn): string {
  if (remaining.months >= 1) {
    return t("orders.warranty.indicator.remainingMonths", { count: remaining.months });
  }
  return t("orders.warranty.indicator.remainingDays", { count: Math.max(1, remaining.totalDays || remaining.days) });
}

type OrderWarrantyIndicatorProps = {
  model: OrderWarrantyIndicatorModel | null | undefined;
  className?: string;
};

/**
 * Compact warranty status under the order number on list/board cards.
 * Renders nothing when the order has no warranty coverage and is not a warranty claim.
 */
export function OrderWarrantyIndicator({ model, className }: OrderWarrantyIndicatorProps) {
  const { t, i18n } = useTranslation();
  if (!model?.visible) return null;

  const language = i18n.language || "en";
  const unit = mileageUnitAbbreviation(snapshotMileageUnit(model.primary), t);
  const label = model.isWarrantyOrder ? t("orders.warranty.claimBadge") : t("orders.warranty.badge");
  const evaluation = model.evaluation;
  const expired = isWarrantyExpired(model.status);
  const dateLabel = formatWarrantyEndsOn(evaluation?.expiresOn ?? model.primary?.endsOn ?? null);
  const remainingKm =
    evaluation?.remainingMileage != null && evaluation.remainingMileage > 0
      ? formatWarrantyKm(evaluation.remainingMileage, language)
      : null;
  const expiredMileage =
    model.status === "expired_mileage" && evaluation?.expiresAtMileage != null
      ? formatWarrantyKm(evaluation.expiresAtMileage, language)
      : null;

  // Mileage of the whole order (furthest mileage limit still running), shown together with the months.
  const orderMileageUnit = model.mileage ? mileageUnitAbbreviation(model.mileage.unit, t) : unit;
  const orderMileageText = model.mileage
    ? model.mileage.remaining != null
      ? `${formatWarrantyKm(model.mileage.remaining, language)} ${orderMileageUnit}`
      : model.mileage.until != null
        ? t("orders.warranty.indicator.untilMileage", {
            value: formatWarrantyKm(model.mileage.until, language),
            unit: orderMileageUnit,
          })
        : null
    : null;

  const startDateLabel = formatWarrantyEndsOn(model.primary?.startsAt?.slice(0, 10) ?? null);
  const paused = model.status === "paused";

  let primaryText: string = label;
  if (expired) {
    primaryText = model.isWarrantyOrder
      ? `${t("orders.warranty.claimBadge")} · ${t("orders.warranty.indicator.expired")}`
      : t("orders.warranty.indicator.expired");
  } else if (paused) {
    primaryText = startDateLabel
      ? t("orders.warranty.pausedSinceClose", { date: startDateLabel })
      : t("orders.warranty.status.paused");
  } else if (model.remaining) {
    const remainingText =
      model.remaining.months >= 1
        ? t("orders.warranty.indicator.remainingMonths", { count: model.remaining.months })
        : t("orders.warranty.indicator.remainingDays", {
            count: Math.max(1, model.remaining.totalDays || model.remaining.days),
          });
    // «Гарантия · Осталось 9 месяцев / 6 214 ми»
    primaryText = orderMileageText ? `${label} · ${remainingText} / ${orderMileageText}` : `${label} · ${remainingText}`;
  } else if (model.mileage?.remaining != null) {
    primaryText = `${label} · ${t("orders.warranty.indicator.remainingKm", {
      value: formatWarrantyKm(model.mileage.remaining, language),
      unit: orderMileageUnit,
    })}`;
  } else if (remainingKm) {
    primaryText = `${label} · ${t("orders.warranty.indicator.remainingKm", { value: remainingKm, unit })}`;
  } else if (model.isWarrantyOrder) {
    primaryText = label;
  }

  const secondaryParts: string[] = [];
  if (expired) {
    if (model.status === "expired_date") {
      secondaryParts.push(t("orders.warranty.status.expired_date"));
      if (dateLabel) secondaryParts.push(dateLabel);
    } else if (model.status === "expired_mileage") {
      secondaryParts.push(t("orders.warranty.status.expired_mileage"));
      if (expiredMileage) secondaryParts.push(t("orders.warranty.indicator.expiredAtKm", { value: expiredMileage, unit }));
    } else if (dateLabel) {
      secondaryParts.push(dateLabel);
    }
  } else if (paused) {
    secondaryParts.push(t("orders.warranty.status.paused"));
  } else {
    if (dateLabel) secondaryParts.push(t("orders.warranty.indicator.untilDate", { date: dateLabel }));
    // Mileage already sits next to the months in the first line; only fall back here when it did not.
    if (model.mileage) {
      if (!model.remaining && model.mileage.remaining == null && model.mileage.until != null) {
        secondaryParts.push(
          t("orders.warranty.indicator.untilMileage", {
            value: formatWarrantyKm(model.mileage.until, language),
            unit: orderMileageUnit,
          }),
        );
      }
    } else if (remainingKm) {
      secondaryParts.push(t("orders.warranty.indicator.remainingKm", { value: remainingKm, unit }));
    } else {
      // Current mileage unknown: still show the mileage limit as «до 106 214 ми».
      const expiresAt = evaluation?.expiresAtMileage ?? model.primary?.expiresAtMileage ?? null;
      if (expiresAt != null && Number.isFinite(Number(expiresAt)) && Number(expiresAt) > 0) {
        secondaryParts.push(
          t("orders.warranty.indicator.untilMileage", { value: formatWarrantyKm(Number(expiresAt), language), unit }),
        );
      }
    }
    if (model.activeItemCount < model.coveredItemCount && model.activeItemCount > 0) {
      // Some items already ran out: «2 из 3 позиций», then «1 из 3 позиций».
      secondaryParts.push(
        t("orders.warranty.indicator.activeOfCoveredItems", {
          active: model.activeItemCount,
          count: model.coveredItemCount,
        }),
      );
    } else if (model.coveredItemCount > 1) {
      secondaryParts.push(t("orders.warranty.indicator.coveredItems", { count: model.coveredItemCount }));
    }
  }

  // Under-order-number colors: active = green, paused = amber, expired/pending/other = neutral gray.
  const toneClass =
    model.status === "active"
      ? "text-success"
      : paused
        ? "text-amber-700 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <div
      className={cn("min-w-0 text-[11px] leading-snug", toneClass, className)}
      data-warranty-indicator
      data-warranty-status={model.status}
      data-warranty-near-expiry={model.nearExpiry ? "true" : undefined}
      data-warranty-expired={expired ? "true" : undefined}
    >
      <p className="truncate font-medium">{primaryText}</p>
      {secondaryParts.length > 0 ? <p className="truncate tabular-nums">{secondaryParts.join(" · ")}</p> : null}
    </div>
  );
}
