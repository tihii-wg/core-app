import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { PaymentStatusBadge } from "../../ui/StatusBadge";
import { Skeleton } from "../../ui/Skeleton";
import type { ClientOrderSummary } from "./clientOrders";
import { computeClientSettlement, settlementBalanceTone } from "./clientSettlement";

type ClientSettlementDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientName: string;
  /** Stored clients.balance (positive = client debt, negative = credit). */
  clientBalance: number;
  orders: ClientOrderSummary[];
  ordersLoading?: boolean;
  ordersError?: boolean;
  formatMoney: (value: number) => string;
  onOpenOrder?: (orderId: string) => void;
};

const balanceToneClass = {
  debt: "text-destructive",
  credit: "text-emerald-600 dark:text-emerald-400",
  settled: "text-foreground",
} as const;

export default function ClientSettlementDialog({
  open,
  onOpenChange,
  clientName,
  clientBalance,
  orders,
  ordersLoading = false,
  ordersError = false,
  formatMoney,
  onOpenOrder,
}: ClientSettlementDialogProps) {
  const { t } = useTranslation();
  const settlement = useMemo(() => computeClientSettlement(orders, clientBalance), [orders, clientBalance]);
  const tone = settlementBalanceTone(settlement.finalBalance);
  const signedFinalBalance = settlement.finalBalance > 0 ? `+${formatMoney(settlement.finalBalance)}` : formatMoney(settlement.finalBalance);

  function handleOpenOrder(orderId: string) {
    onOpenOrder?.(orderId);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-hidden p-4 sm:max-w-2xl sm:gap-5 sm:p-6">
        <DialogHeader className="min-w-0 flex-none">
          <DialogTitle>{t("clients.settlement.title")}</DialogTitle>
          <DialogDescription>{t("clients.settlement.description", { name: clientName })}</DialogDescription>
        </DialogHeader>

        {ordersLoading ? (
          <div className="min-h-0 min-w-0 flex-1 space-y-2 overflow-y-auto" aria-busy="true">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : ordersError ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
              <p className="text-sm font-medium text-foreground">{t("clients.settlement.loadFailed")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("clients.settlement.loadFailedHint")}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="min-w-0 flex-none space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-lg border border-border bg-muted/50 p-2.5 sm:p-3">
                <p className="text-xs font-medium text-muted-foreground">{t("clients.settlement.existingBalance")}</p>
                <p className="mt-1 text-base font-semibold tabular-nums sm:text-lg text-foreground">{formatMoney(settlement.existingBalance)}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/50 p-2.5 sm:p-3">
                <p className="text-xs font-medium text-muted-foreground">{t("clients.settlement.displayedOrderTotal")}</p>
                <p className="mt-1 text-base font-semibold tabular-nums sm:text-lg text-foreground">{formatMoney(settlement.displayedOrderTotal)}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/50 p-2.5 sm:p-3">
                <p className="text-xs font-medium text-muted-foreground">{t("clients.settlement.totalOutstanding")}</p>
                <p className="mt-1 text-base font-semibold tabular-nums sm:text-lg text-foreground">{formatMoney(settlement.totalOutstanding)}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/50 p-2.5 sm:p-3">
                <p className="text-xs font-medium text-muted-foreground">{t("clients.settlement.balance")}</p>
                <p className={`mt-1 text-base font-semibold tabular-nums sm:text-lg ${balanceToneClass[tone]}`}>{signedFinalBalance}</p>
              </div>
            </div>

            </div>

            <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
            <p className="text-xs text-muted-foreground">{t("clients.settlement.signExplanation")}</p>

            {settlement.rows.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
                <p className="text-sm font-medium text-foreground">{t("clients.settlement.empty")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("clients.settlement.emptyHint")}</p>
              </div>
            ) : (
              <div className="max-w-full min-w-0 overflow-x-auto overscroll-contain rounded-lg border border-border">
                <table className="w-full min-w-[540px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">{t("clients.settlement.columns.order")}</th>
                      <th className="px-3 py-2 font-medium">{t("clients.settlement.columns.date")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("clients.settlement.columns.total")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("clients.settlement.columns.paid")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("clients.settlement.columns.remaining")}</th>
                      <th className="px-3 py-2 font-medium">{t("clients.settlement.columns.status")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                  {settlement.rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={onOpenOrder ? () => handleOpenOrder(row.id) : undefined}
                      className={onOpenOrder ? "cursor-pointer transition-colors hover:bg-muted/60" : undefined}
                    >
                      <td className="px-3 py-2 font-medium tabular-nums">
                        {onOpenOrder ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleOpenOrder(row.id);
                            }}
                            className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                          >
                            {row.orderNumber}
                          </button>
                        ) : (
                          <span className="text-primary">{row.orderNumber}</span>
                        )}
                      </td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.date || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.paid)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.remaining)}</td>
                        <td className="px-3 py-2">
                          <PaymentStatusBadge status={row.isPaid ? "paid" : "unpaid"} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/50 font-medium">
                      <td className="px-3 py-2" colSpan={2}>{t("clients.settlement.totalRow")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(settlement.displayedOrderTotal)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(settlement.displayedPaid)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(settlement.totalOutstanding)}</td>
                      <td className="px-3 py-2" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {settlement.settledOrdersCount > 0 ? (
              <p className="text-xs text-muted-foreground">{t("clients.settlement.settledExcluded", { count: settlement.settledOrdersCount })}</p>
            ) : null}
            {settlement.excludedCancelledCount > 0 ? (
              <p className="text-xs text-muted-foreground">{t("clients.settlement.cancelledExcluded", { count: settlement.excludedCancelledCount })}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">{t("clients.settlement.paymentNote")}</p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
