import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { PaymentStatusBadge, StatusBadge } from "../../ui/StatusBadge";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { withSubscriptionWriteAccess } from "../workspaces/workspaceSubscription";
import { financeDateKey } from "./financeStats";
import {
  invoicePaymentBalance,
  isFullyVoidedPayment,
  orderPaymentBalance,
  paymentsForInvoice,
  paymentsForOrder,
} from "./paymentCalculations";
import { allocatePaid, currentPaymentStage } from "./paymentStages";
import type { LedgerPayment, PaymentBalance } from "./paymentTypes";
import { DeleteFullyVoidedPaymentDialog } from "./DeleteFullyVoidedPaymentDialog";
import { PaymentActionsMenu } from "./PaymentActionsMenu";
import { PaymentFormDialog } from "./PaymentFormDialog";
import { PaymentVoidDialog } from "./PaymentVoidDialog";
import { RefundFormDialog } from "./RefundFormDialog";
import { useOrderPaymentStages } from "./useOrderPaymentStages";
import type { Invoice, Order } from "../../lib/types";
import { useReportFormatting } from "../reports/reportFormatting";

type PaymentHistorySectionProps = {
  target: "order" | "invoice";
  order?: Pick<Order, "id" | "totalPrice" | "isPaid" | "status" | "orderNumber"> | null;
  invoice?: Pick<Invoice, "id" | "total" | "amount" | "status" | "invoiceNumber" | "orderId"> | null;
  payments: LedgerPayment[];
  isLoading?: boolean;
  canRecord?: boolean;
  /** When set, runs before opening the record-payment dialog (e.g. save dirty order edits). */
  onBeforeRecord?: () => Promise<boolean>;
  /** Full order: enables «Статус заказа после оплаты» in the payment dialog. */
  fullOrder?: Order | null;
  onOrderUpdated?: (order: Order) => void;
};

function kindBadgeVariant(kind: LedgerPayment["kind"]): "success" | "warning" | "danger" {
  if (kind === "refund") return "warning";
  if (kind === "void") return "danger";
  return "success";
}

export function PaymentHistorySection({
  target,
  order,
  invoice,
  payments,
  isLoading,
  canRecord: canRecordProp,
  onBeforeRecord,
  fullOrder,
  onOrderUpdated,
}: PaymentHistorySectionProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const { formatDate } = useReportFormatting();
  const { canWrite } = useWorkspaceSubscription();
  const role = useActiveWorkspaceRole();
  const canRecord = canRecordProp ?? withSubscriptionWriteAccess(Boolean(role), canWrite);
  const { stages: paymentStages } = useOrderPaymentStages(target === "order" ? order?.id : undefined);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [refundOriginal, setRefundOriginal] = useState<LedgerPayment | null>(null);
  const [voidOriginal, setVoidOriginal] = useState<LedgerPayment | null>(null);
  const [cleanupOriginal, setCleanupOriginal] = useState<LedgerPayment | null>(null);
  const [openingRecord, setOpeningRecord] = useState(false);

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

  const currentStage = useMemo(() => {
    if (target !== "order" || !order || paymentStages.length === 0) return null;
    const allocated = allocatePaid(
      paymentStages.map((stage) => ({
        id: stage.id,
        position: stage.position,
        name: stage.name,
        mode: stage.mode,
        percent: stage.percent,
        amount: stage.amount,
        dueDate: stage.dueDate,
        invoiceId: stage.invoiceId,
      })),
      order.totalPrice,
      balance.netPaid,
    );
    return currentPaymentStage(allocated);
  }, [target, order, paymentStages, balance.netPaid]);

  const dialogBalance: PaymentBalance =
    currentStage && currentStage.remaining > 0.005
      ? { ...recordableBalance, remaining: currentStage.remaining }
      : recordableBalance;

  return (
    <div className="space-y-3 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t("finance.payments.history")}</h3>
        {canOpenPayment && (
          <Button
            type="button"
            size="sm"
            disabled={isLoading || openingRecord}
            onClick={() => {
              void (async () => {
                if (onBeforeRecord) {
                  setOpeningRecord(true);
                  try {
                    if (!(await onBeforeRecord())) return;
                  } finally {
                    setOpeningRecord(false);
                  }
                }
                setPaymentOpen(true);
              })();
            }}
          >
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
            const voided = row.kind === "payment" && isFullyVoidedPayment(row, payments);
            const isOffset = row.kind === "refund" || row.kind === "void";
            return (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5 text-sm">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge variant={kindBadgeVariant(row.kind)}>
                      {t(`finance.payments.kinds.${row.kind}`)}
                    </StatusBadge>
                    {voided ? (
                      <StatusBadge variant="danger">{t("finance.payments.void.badge")}</StatusBadge>
                    ) : null}
                    <span className="text-muted-foreground">{formatDate(financeDateKey(row.paidAt))}</span>
                    <span className="text-muted-foreground">{t(`finance.paymentMethods.short.${row.paymentMethod}`)}</span>
                  </div>
                  {row.note ? <p className="text-muted-foreground [overflow-wrap:anywhere]">{row.note}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`font-medium tabular-nums ${isOffset ? "text-destructive" : "text-success"}`}>
                    {isOffset ? "-" : "+"}
                    {formatMoney(row.amount)}
                  </span>
                  {row.kind === "payment" ? (
                    <PaymentActionsMenu
                      payment={row}
                      allPayments={payments}
                      canRecord={canRecord}
                      onRefund={setRefundOriginal}
                      onVoidErroneous={setVoidOriginal}
                      onDeleteErroneous={setCleanupOriginal}
                    />
                  ) : null}
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
        order={target === "order" ? (fullOrder ?? null) : null}
        onOrderUpdated={onOrderUpdated}
        balance={dialogBalance}
        currentStageLabel={
          currentStage
            ? t("finance.paymentStages.currentlyPaying", {
                name: currentStage.name,
                amount: formatMoney(currentStage.remaining),
              })
            : null
        }
      />
      <RefundFormDialog open={refundOriginal != null} onOpenChange={(open) => !open && setRefundOriginal(null)} original={refundOriginal} allPayments={payments} />
      <PaymentVoidDialog
        open={voidOriginal != null}
        onOpenChange={(open) => !open && setVoidOriginal(null)}
        payment={voidOriginal}
        allPayments={payments}
        canRecord={canRecord}
      />
      <DeleteFullyVoidedPaymentDialog
        open={cleanupOriginal != null}
        onOpenChange={(open) => !open && setCleanupOriginal(null)}
        payment={cleanupOriginal}
        allPayments={payments}
        canRecord={canRecord}
      />
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
