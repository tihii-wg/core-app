import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { isWarrantyExpired, type OrderWarrantyIndicatorModel, type RemainingDuration } from "./warranty";

/** Format YYYY-MM-DD as DD.MM.YYYY (matches warranty indicator copy across locales). */
export function formatWarrantyEndsOn(endsOn: string | null | undefined): string | null {
  if (!endsOn?.trim()) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endsOn.trim());
  if (!match) return endsOn.trim();
  return `${match[3]}.${match[2]}.${match[1]}`;
}

export function formatWarrantyKm(value: number, language: string): string {
  return new Intl.NumberFormat(language || "en", { maximumFractionDigits: 0 }).format(Math.max(0, Math.floor(value)));
}

type TranslateFn = (key: string, options?: { count?: number; value?: string; date?: string }) => string;

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

  let primaryText: string = label;
  if (expired) {
    primaryText = model.isWarrantyOrder
      ? `${t("orders.warranty.claimBadge")} · ${t("orders.warranty.indicator.expired")}`
      : t("orders.warranty.indicator.expired");
  } else if (model.remaining) {
    const remainingText =
      model.remaining.months >= 1
        ? t("orders.warranty.indicator.remainingMonths", { count: model.remaining.months })
        : t("orders.warranty.indicator.remainingDays", {
            count: Math.max(1, model.remaining.totalDays || model.remaining.days),
          });
    primaryText = `${label} · ${remainingText}`;
  } else if (remainingKm) {
    primaryText = `${label} · ${t("orders.warranty.indicator.remainingKm", { value: remainingKm })}`;
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
      if (expiredMileage) secondaryParts.push(t("orders.warranty.indicator.expiredAtKm", { value: expiredMileage }));
    } else if (dateLabel) {
      secondaryParts.push(dateLabel);
    }
  } else {
    if (dateLabel) secondaryParts.push(t("orders.warranty.indicator.untilDate", { date: dateLabel }));
    // Show remaining mileage whenever known (including when both time and mileage limits apply).
    if (remainingKm) {
      secondaryParts.push(t("orders.warranty.indicator.remainingKm", { value: remainingKm }));
    }
    if (model.coveredItemCount > 1) {
      secondaryParts.push(t("orders.warranty.indicator.coveredItems", { count: model.coveredItemCount }));
    }
  }

  // Under-order-number colors only: active = green, expired/pending/other = neutral gray.
  const toneClass = model.status === "active" ? "text-success" : "text-muted-foreground";

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
