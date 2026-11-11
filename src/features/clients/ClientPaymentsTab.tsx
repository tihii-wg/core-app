import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Calculator } from "lucide-react";
import type { Client } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { StatusBadge } from "../../ui/StatusBadge";
import { financeDateKey } from "../finance/financeStats";
import { isFullyVoidedPayment } from "../finance/paymentCalculations";
import type { LedgerPayment } from "../finance/paymentTypes";
import { useGetInvoices } from "../invoices/useGetInvoices";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import type { ClientOrderSummary } from "./clientOrders";
import { clientLedgerPayments } from "./clientPayments";
import { computeClientSettlement, settlementBalanceTone } from "./clientSettlement";

type ClientPaymentsTabProps = {
  client: Client;
  clientOrders: ClientOrderSummary[];
  payments: LedgerPayment[];
  paymentsLoading?: boolean;
  ordersLoading?: boolean;
  onOpenSettlement: () => void;
};

const balanceToneClass = {
  debt: "text-destructive",
  credit: "text-emerald-600 dark:text-emerald-400",
  settled: "text-foreground",
} as const;

function kindBadgeVariant(kind: LedgerPayment["kind"]): "success" | "warning" | "danger" {
  if (kind === "refund") return "warning";
  if (kind === "void") return "danger";
  return "success";
}

function SummaryStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/50 p-2.5 sm:p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 break-all text-base font-semibold tabular-nums sm:text-lg ${className ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

/** Ledger payments for the client's orders (and invoices) + the same settlement totals as the settlement dialog. */
export function ClientPaymentsTab({
  client,
  clientOrders,
  payments,
  paymentsLoading = false,
  ordersLoading = false,
  onOpenSettlement,
}: ClientPaymentsTabProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  // Invoice-linked ledger rows: invoices of this client or for any of its orders.
  const { invoices } = useGetInvoices({ enabled: true });

  const orderIds = useMemo(() => clientOrders.map((order) => order.id), [clientOrders]);
  const orderNumberById = useMemo(() => new Map(clientOrders.map((order) => [order.id, order.orderNumber])), [clientOrders]);

  const clientInvoices = useMemo(() => {
    const ids = new Set(orderIds);
    return invoices.filter((invoice) => invoice.clientId === client.id || (invoice.orderId != null && ids.has(invoice.orderId)));
  }, [invoices, orderIds, client.id]);
  const invoiceById = useMemo(() => new Map(clientInvoices.map((invoice) => [invoice.id, invoice])), [clientInvoices]);

  const rows = useMemo(
    () => clientLedgerPayments(payments, orderIds, clientInvoices.map((invoice) => invoice.id)),
    [payments, orderIds, clientInvoices],
  );

  // Same inputs as ClientSettlementDialog → identical totals.
  const settlement = useMemo(
    () => computeClientSettlement(clientOrders, client.balance, payments),
    [clientOrders, client.balance, payments],
  );
  const tone = settlementBalanceTone(settlement.finalBalance);
  const signedFinalBalance =
    settlement.finalBalance > 0 ? `+${formatMoney(settlement.finalBalance)}` : formatMoney(settlement.finalBalance);

  const loading = ordersLoading || paymentsLoading;

  return (
    <div className="space-y-5" data-testid="client-payments-tab">
      <section className="space-y-3" aria-label={t("clients.detail.payments.summary")} data-testid="client-payments-summary">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">
            {t("clients.detail.payments.summary")}
          </h3>
          <Button type="button" variant="outline" size="sm" className="min-h-9" onClick={onOpenSettlement}>
            <Calculator />
            {t("clients.settlement.button")}
          </Button>
        </div>
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <SummaryStat label={t("clients.settlement.existingBalance")} value={formatMoney(settlement.existingBalance)} />
            <SummaryStat label={t("clients.settlement.displayedOrderTotal")} value={formatMoney(settlement.displayedOrderTotal)} />
            <SummaryStat label={t("clients.settlement.columns.paid")} value={formatMoney(settlement.displayedPaid)} />
            <SummaryStat label={t("clients.settlement.totalOutstanding")} value={formatMoney(settlement.totalOutstanding)} />
            <div className="col-span-2">
              <SummaryStat
                label={t("clients.settlement.balance")}
                value={signedFinalBalance}
                className={balanceToneClass[tone]}
              />
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">{t("clients.detail.tabs.payments")}</h3>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
            <p className="text-[13px] font-medium text-foreground">{t("clients.detail.payments.noPayments")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border" data-testid="client-payments-list">
            {rows.map((row) => {
              const isOffset = row.kind === "refund" || row.kind === "void";
              const voided = row.kind === "payment" && isFullyVoidedPayment(row, payments);
              const invoice = row.invoiceId ? invoiceById.get(row.invoiceId) : undefined;
              const orderNumber =
                (row.orderId ? orderNumberById.get(row.orderId) : undefined) ?? invoice?.orderNumber ?? "";
              const reference = orderNumber
                ? t("clients.detail.payments.order", { number: orderNumber })
                : invoice
                  ? t("clients.detail.payments.invoice", { number: invoice.invoiceNumber })
                  : "";
              return (
                <li key={row.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-muted-foreground tabular-nums">{financeDateKey(row.paidAt)}</span>
                      <StatusBadge variant={kindBadgeVariant(row.kind)}>{t(`finance.payments.kinds.${row.kind}`)}</StatusBadge>
                      {voided ? <StatusBadge variant="danger">{t("finance.payments.void.badge")}</StatusBadge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {[reference, t(`finance.paymentMethods.short.${row.paymentMethod}`)].filter(Boolean).join(" · ")}
                    </p>
                    {row.note ? <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{row.note}</p> : null}
                  </div>
                  <span className={`shrink-0 font-medium tabular-nums ${isOffset ? "text-destructive" : "text-success"}`}>
                    {isOffset ? "-" : "+"}
                    {formatMoney(row.amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
