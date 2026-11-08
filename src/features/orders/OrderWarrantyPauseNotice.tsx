import { useTranslation } from "react-i18next";
import type { Order } from "../../lib/types";
import { formatWarrantyEndsOn } from "./OrderWarrantyIndicator";
import { isWarrantySourceFormallyClosed, type WarrantySnapshot } from "./warranty";

type Props = {
  order: Pick<Order, "status" | "closedAt">;
  /** Existing warranty_records for this order (any length > 0 triggers the notice). */
  records: readonly Pick<WarrantySnapshot, "startsAt">[];
  className?: string;
};

/** Info box on cancelled / reopened orders that still have warranty snapshots. */
export function OrderWarrantyPauseNotice({ order, records, className }: Props) {
  const { t } = useTranslation();
  if (isWarrantySourceFormallyClosed(order) || records.length === 0) return null;

  const earliestStart = records
    .map((row) => row.startsAt)
    .filter((value): value is string => Boolean(value?.trim()))
    .sort()[0];
  const dateLabel = formatWarrantyEndsOn(earliestStart?.slice(0, 10)) ?? earliestStart?.slice(0, 10) ?? "—";

  return (
    <div
      className={
        className ??
        "rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-foreground"
      }
      data-warranty-pause-notice
      role="status"
    >
      <p className="text-sm leading-snug">{t("orders.warranty.pauseNotice", { date: dateLabel })}</p>
    </div>
  );
}
