import { useMemo, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { PaymentStatusBadge, StatusBadge } from "../../ui/StatusBadge";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { withSubscriptionWriteAccess } from "../workspaces/workspaceSubscription";
import { financeDateKey } from "./financeStats";
import { invoicePaymentBalance, orderPaymentBalance, paymentsForInvoice, paymentsForOrder, refundableRemaining } from "./paymentCalculations";
import type { LedgerPayment, PaymentBalance } from "./paymentTypes";
import { PaymentFormDialog } from "./PaymentFormDialog";
import { RefundFormDialog } from "./RefundFormDialog";
import type { Invoice, Order } from "../../lib/types";
import { useReportFormatting } from "../reports/reportFormatting";

type PaymentHistorySectionProps = {
  target: "order" | "invoice";
  order?: Pick<Order, "id" | "totalPrice" | "isPaid" | "status" | "orderNumber"> | null;
  invoice?: Pick<Invoice, "id" | "total" | "amount" | "status" | "invoiceNumber" | "orderId"> | null;
  payments: LedgerPayment[];
  isLoading?: boolean;
  canRecord?: boolean;
};

export function PaymentHistorySection({ target, order, invoice, payments, isLoading, canRecord: canRecordProp }: PaymentHistorySectionProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const { formatDate } = useReportFormatting();
  const { canWrite } = useWorkspaceSubscription();
  const role = useActiveWorkspaceRole();
  const canRecord = canRecordProp ?? withSubscriptionWriteAccess(Boolean(role), canWrite);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [refundOriginal, setRefundOriginal] = useState<LedgerPayment | null>(null);

  const linked = useMemo(() => {
    if (target === "order" && order) return paymentsForOrder(payments, order.id);
    if (target === "invoice" && invoice) return paymentsForInvoice(payments, invoice.id);
    return [];
  }, [target, order, invoice, payments]);

  const balance: PaymentBalance = useMemo(() => {
    if (target === "order" && order) return orderPaymentBalance(order, payments);
    if (target === "invoice" && invoice) return invoicePaymentBalance(invoice, payments);
    return {
      total: 0,
      netPaid: 0,
      remaining: 0,
      overpayment: 0,
      status: "unpaid",
      hasLedger: false,
      isLegacyUnreconciled: false,
    };
  }, [target, order, invoice, payments]);

  /** For dialog + "record" CTA: legacy paid-with-no-ledger still needs a first ledger row up to total. */
  const recordableBalance: PaymentBalance = balance.isLegacyUnreconciled
    ? { ...balance, remaining: balance.total, netPaid: 0, status: "unpaid" }
    : balance;

  const orderId = target === "order" ? order?.id : invoice?.orderId ?? null;
  const invoiceId = target === "invoice" ? invoice?.id : null;
  const canOpenPayment = canRecord && recordableBalance.remaining > 0;

  return (
    <div className="space-y-3 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t("finance.payments.history")}</h3>
        {canOpenPayment && (
          <Button type="button" size="sm" onClick={() => setPaymentOpen(true)} disabled={isLoading}>
            <Plus className="size-4" />
            {t("finance.payments.record")}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <BalanceStat label={t("finance.payments.amountDue")} value={formatMoney(balance.total)} />
        <BalanceStat
          label={t("finance.payments.amountPaid")}
          value={balance.isLegacyUnreconciled ? formatMoney(balance.total) : formatMoney(balance.netPaid)}
        />
        <BalanceStat
          label={t("finance.payments.remaining")}
          value={formatMoney(balance.isLegacyUnreconciled ? 0 : balance.remaining)}
        />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{t("orders.table.payment")}</p>
          <div className="mt-1 flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
            <PaymentStatusBadge status={balance.status} />
            {balance.isLegacyUnreconciled ? (
              <StatusBadge variant="warning">{t("finance.payments.legacyBadge")}</StatusBadge>
            ) : null}
            {balance.overpayment > 0 ? (
              <span className="text-xs text-warning [overflow-wrap:anywhere]">
                {t("finance.payments.overpayment")}: {formatMoney(balance.overpayment)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loadingEllipsis")}</p>
      ) : linked.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("finance.payments.noPayments")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {linked.map((row) => {
            const refundable = row.kind === "payment" ? refundableRemaining(row, payments) : 0;
            return (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5 text-sm">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge variant={row.kind === "refund" ? "warning" : "success"}>
                      {t(`finance.payments.kinds.${row.kind}`)}
                    </StatusBadge>
                    <span className="text-muted-foreground">{formatDate(financeDateKey(row.paidAt))}</span>
                    <span className="text-muted-foreground">{t(`finance.paymentMethods.short.${row.paymentMethod}`)}</span>
                  </div>
                  {row.note ? <p className="text-muted-foreground [overflow-wrap:anywhere]">{row.note}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`font-medium tabular-nums ${row.kind === "refund" ? "text-destructive" : "text-success"}`}>
                    {row.kind === "refund" ? "-" : "+"}
                    {formatMoney(row.amount)}
                  </span>
                  {canRecord && row.kind === "payment" && refundable > 0 && (
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t("finance.payments.refund")} onClick={() => setRefundOriginal(row)}>
                      <RotateCcw className="size-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <PaymentFormDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        target={target}
        orderId={orderId}
        invoiceId={invoiceId}
        balance={recordableBalance}
      />
      <RefundFormDialog open={refundOriginal != null} onOpenChange={(open) => !open && setRefundOriginal(null)} original={refundOriginal} allPayments={payments} />
    </div>
  );
}

function BalanceStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}
