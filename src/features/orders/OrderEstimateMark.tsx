import { useTranslation } from "react-i18next";
import type { Order } from "../../lib/types";
import { StatusBadge } from "../../ui/StatusBadge";
import { isEstimateOrder } from "./orderEstimates";

/** «Расчёт» mark next to the number in the mixed orders list (table and cards). Renders nothing for orders. */
export function OrderEstimateMark({ order, className }: { order: Pick<Order, "kind">; className?: string }) {
  const { t } = useTranslation();
  if (!isEstimateOrder(order)) return null;
  return (
    <StatusBadge variant="info" className={className}>
      {t("orders.estimates.badge")}
    </StatusBadge>
  );
}
