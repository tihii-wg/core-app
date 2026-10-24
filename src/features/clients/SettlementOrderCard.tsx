import { useTranslation } from "react-i18next";
import { OrderStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import type { ClientSettlementRow } from "./clientSettlement";

type SettlementOrderCardProps = {
  row: ClientSettlementRow;
  formatMoney: (value: number) => string;
  onOpen?: (orderId: string) => void;
};

/**
 * Compact phone layout for one unpaid settlement order (below the md
 * breakpoint). Mirrors OrderCard / InvoiceCard: whole surface opens the
 * order; amount + badges sit on a footer row with truncation for narrow
 * viewports (320–440px).
 */
export function SettlementOrderCard({ row, formatMoney, onOpen }: SettlementOrderCardProps) {
  const { t } = useTranslation();
  const registration = row.carNumber?.trim() || "";
  const device = row.device?.trim() || "";
  const service = row.service?.trim() || "";
  const interactive = Boolean(onOpen);

  return (
    <article
      onClick={interactive ? () => onOpen?.(row.id) : undefined}
      className={
        interactive
          ? "cursor-pointer rounded-lg border border-border bg-card p-3 shadow-xs transition-colors hover:bg-accent/40 active:bg-accent/60"
          : "rounded-lg border border-border bg-card p-3 shadow-xs"
      }
    >
      <div className="min-w-0">
        {interactive ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen?.(row.id);
            }}
            className="block max-w-full break-all text-left font-semibold text-primary tabular-nums hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
          >
            {row.orderNumber}
          </button>
        ) : (
          <p className="break-all font-semibold text-primary tabular-nums">{row.orderNumber}</p>
        )}

        {(device || registration || service) && (
          <div className="mt-1.5 min-w-0 text-sm text-muted-foreground">
            {device ? (
              <p className="truncate" title={device}>
                {device}
              </p>
            ) : null}
            {registration ? (
              <p className="truncate text-xs tabular-nums" title={registration}>
                {registration}
              </p>
            ) : null}
            {!device && service ? (
              <p className="truncate" title={service}>
                {service}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-2.5">
        <OrderStatusBadge status={row.status} />
        <PaymentStatusBadge status={row.isPaid ? "paid" : "unpaid"} />
        <span className="ml-auto min-w-0 max-w-full text-right">
          <span className="block text-[11px] font-medium text-muted-foreground">{t("clients.settlement.columns.remaining")}</span>
          <span className="block break-all font-semibold tabular-nums text-foreground">{formatMoney(row.remaining)}</span>
          <span className="block text-[11px] tabular-nums text-muted-foreground">{row.date || "—"}</span>
        </span>
      </div>
      {interactive ? <span className="sr-only">{t("orders.actions.viewDetails")}</span> : null}
    </article>
  );
}
