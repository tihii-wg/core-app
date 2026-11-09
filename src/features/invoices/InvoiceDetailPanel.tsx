import { useState } from "react";
import { AlertTriangle, CircleCheck, Download, Mail, Printer, RotateCcw, Send, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/EmptyState";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { Spinner } from "../../ui/Spinner";
import { InvoiceStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import type { Invoice, InvoiceStatus } from "../../lib/types";
import { isErroneousInvoiceStatus } from "../../services/apiInvoices";
import { shouldShowOrderAssetValue } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { formatQuantity } from "../../lib/quantity";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { lineTotal } from "./invoiceItemSections";
import { useGetInvoice } from "./useGetInvoices";
import { useInvoiceDocumentData } from "./useInvoiceDocumentData";
import { OrderVatBreakdownView } from "../orders/OrderVatBreakdown";
import { useInvoiceVat } from "./useInvoiceVat";
import { InvoicePrintRoot, type InvoicePrintJob } from "./InvoicePrintRoot";
import { InvoiceEmailDialog } from "./InvoiceEmailDialog";
import { DeleteErroneousInvoiceDialog } from "./DeleteErroneousInvoiceDialog";
import { MarkErroneousInvoiceDialog } from "./MarkErroneousInvoiceDialog";
import { PaymentHistorySection } from "../finance/PaymentHistorySection";
import { invoicePaymentBalance } from "../finance/paymentCalculations";
import { useGetPayments } from "../finance/usePayments";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { withSubscriptionWriteAccess } from "../workspaces/workspaceSubscription";

type InvoiceDetailPanelProps = {
  invoiceId: string | null;
  onClose: () => void;
  isUpdating: boolean;
  onStatusChange: (invoice: Invoice, status: InvoiceStatus) => void;
};

export function InvoiceDetailPanel({ invoiceId, onClose, isUpdating, onStatusChange }: InvoiceDetailPanelProps) {
  const { t, i18n } = useTranslation();
  const { invoice, isLoading, error } = useGetInvoice(invoiceId);
  const { formatMoney } = useWorkspaceMoney();
  const { workflow, copy } = useIndustryWorkflow();
  const documentData = useInvoiceDocumentData(invoice ?? null);
  const [printJob, setPrintJob] = useState<InvoicePrintJob | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [markErroneousOpen, setMarkErroneousOpen] = useState(false);
  const [deleteErroneousOpen, setDeleteErroneousOpen] = useState(false);
  const { payments, isLoading: paymentsLoading } = useGetPayments();
  const { canWrite } = useWorkspaceSubscription();
  const canRecord = withSubscriptionWriteAccess(Boolean(useActiveWorkspaceRole()), canWrite);
  const vat = useInvoiceVat(invoice?.id, invoice?.total, invoice?.orderId);
  const paymentBalance = invoice ? invoicePaymentBalance(invoice, payments) : null;
  const erroneous = invoice ? isErroneousInvoiceStatus(invoice.status) : false;
  const canRecordPayments = canRecord && !erroneous;

  const startPrint = () => {
    if (!invoice) return;
    setPrintJob({
      invoice,
      sections: documentData.sections,
      companyName: documentData.companyName,
      logoUrl: documentData.logoUrl,
      supplier: documentData.supplier,
      formatMoney,
      vatBreakdown: vat,
      documentTitle: `${invoice.invoiceNumber}.pdf`,
    });
  };

  return (
    <Sheet open={invoiceId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-12">
          <SheetTitle className="flex min-w-0 flex-wrap items-center gap-2 tabular-nums">
            {invoice?.invoiceNumber ?? t("invoices.detail.fallbackTitle")}
            {invoice && <InvoiceStatusBadge status={invoice.status} />}
          </SheetTitle>
          <SheetDescription className="sr-only">{t("invoices.detail.srDescription")}</SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="flex justify-center py-14">
            <Spinner className="size-5" />
          </div>
        )}

        {error && <ErrorState title={t("invoices.detail.loadErrorTitle")} description={error.message} />}

        {invoice && (
          <div className="space-y-5 px-5 py-5">
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/50 p-4">
              <div className="min-w-0">
                <h3 className="text-xs font-medium text-muted-foreground">{t("invoices.detail.billTo")}</h3>
                <p className="mt-1 font-medium [overflow-wrap:anywhere] text-foreground">{invoice.clientName || "—"}</p>
              </div>
              <div className="min-w-0 max-w-[55%] shrink-0 text-right [overflow-wrap:anywhere]">
                <h3 className="text-xs font-medium text-muted-foreground">{t("common.total")}</h3>
                <p className="mt-1 text-xl font-semibold tracking-tight text-foreground tabular-nums">{formatMoney(invoice.total)}</p>
                {paymentBalance ? (
                  <div className="mt-2">
                    <PaymentStatusBadge status={paymentBalance.status} />
                  </div>
                ) : null}
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
              <DetailItem label={t("invoices.detail.order")} value={invoice.orderNumber} />
              <DetailItem label={t("invoices.detail.created")} value={invoice.createdAt} />
              {shouldShowOrderAssetValue(workflow.orderFields.device, invoice.device, "device") && (
                <DetailItem label={copy.deviceDetail} value={invoice.device} />
              )}
              {shouldShowOrderAssetValue(workflow.orderFields.carNumber, invoice.carNumber, "carNumber") && (
                <DetailItem label={copy.carNumberDetail} value={invoice.carNumber} />
              )}
              {shouldShowOrderAssetValue(workflow.orderFields.vin, invoice.vin, "vin") && (
                <DetailItem label={copy.vinDetail} value={invoice.vin} mono />
              )}
              <DetailItem label={invoice.status === "paid" ? t("invoices.detail.paidOn") : t("invoices.detail.dueDate")} value={invoice.status === "paid" ? invoice.paidAt : invoice.dueDate} />
              {invoice.description && (
                <div className="col-span-2">
                  <dt className="text-xs font-medium text-muted-foreground">{t("invoices.detail.description")}</dt>
                  <dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground">{invoice.description}</dd>
                </div>
              )}
            </dl>

            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{t("invoices.detail.items.service")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("invoices.detail.items.quantity")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("invoices.detail.items.price")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("invoices.detail.items.amount")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoice.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 [overflow-wrap:anywhere] text-foreground">{item.serviceName}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {formatQuantity(item.quantity, i18n.language)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatMoney(item.price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatMoney(lineTotal(item))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border font-medium">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right text-muted-foreground">
                      {t("common.total")}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatMoney(invoice.total)}</td>
                  </tr>
                  {vat ? (
                    <tr>
                      <td colSpan={4} className="px-3 pb-2 pt-0">
                        <OrderVatBreakdownView
                          breakdown={vat}
                          formatMoney={formatMoney}
                          className="ml-auto max-w-[240px] space-y-0.5 text-xs font-normal text-muted-foreground"
                          testId="invoice-detail-vat"
                        />
                      </td>
                    </tr>
                  ) : null}
                </tfoot>
              </table>
            </div>

            {erroneous ? (
              <div role="status" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {t("invoices.erroneous.banner")}
              </div>
            ) : null}

            <PaymentHistorySection
              target="invoice"
              invoice={invoice}
              payments={payments}
              isLoading={paymentsLoading}
              canRecord={canRecordPayments}
            />

            <div className="flex flex-wrap gap-2 border-t border-border pt-5">
              {!erroneous && invoice.status === "draft" && (
                <Button variant="outline" size="sm" disabled={isUpdating} onClick={() => onStatusChange(invoice, "sent")}>
                  <Send />
                  {t("invoices.actions.markSent")}
                </Button>
              )}
              {!erroneous &&
                (invoice.status === "paid" ? (
                  <Button variant="outline" size="sm" disabled={isUpdating} onClick={() => onStatusChange(invoice, "sent")}>
                    <RotateCcw />
                    {t("invoices.actions.markUnpaid")}
                  </Button>
                ) : (
                  <Button size="sm" disabled={isUpdating} onClick={() => onStatusChange(invoice, "paid")}>
                    <CircleCheck />
                    {t("invoices.actions.markPaid")}
                  </Button>
                ))}
              {!erroneous && (
                <Button variant="outline" size="sm" disabled={isUpdating} onClick={() => setMarkErroneousOpen(true)}>
                  <AlertTriangle />
                  {t("invoices.actions.markErroneous")}
                </Button>
              )}
              {erroneous && (
                <Button variant="destructive" size="sm" disabled={isUpdating} onClick={() => setDeleteErroneousOpen(true)}>
                  <Trash2 />
                  {t("invoices.actions.deleteErroneous")}
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={documentData.isLoading} onClick={startPrint}>
                <Download />
                {t("invoices.actions.downloadPdf")}
              </Button>
              <Button variant="outline" size="sm" disabled={documentData.isLoading} onClick={startPrint}>
                <Printer />
                {t("invoices.actions.previewPrint")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={documentData.isLoading || erroneous}
                onClick={() => setEmailOpen(true)}
              >
                <Mail />
                {t("invoices.actions.sendEmail")}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
      {printJob ? <InvoicePrintRoot job={printJob} onDone={() => setPrintJob(null)} /> : null}
      {emailOpen && invoice && !erroneous ? (
        <InvoiceEmailDialog invoice={invoice} onClose={() => setEmailOpen(false)} onDownloadPdf={startPrint} />
      ) : null}
      <MarkErroneousInvoiceDialog
        invoice={markErroneousOpen && invoice ? invoice : null}
        onClose={() => setMarkErroneousOpen(false)}
      />
      <DeleteErroneousInvoiceDialog
        invoice={deleteErroneousOpen && invoice ? invoice : null}
        onClose={() => setDeleteErroneousOpen(false)}
        onDeleted={onClose}
      />
    </Sheet>
  );
}

function DetailItem({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-1 font-mono text-[13px] [overflow-wrap:anywhere] text-foreground" : "mt-1 font-medium [overflow-wrap:anywhere] text-foreground"}>
        {value || <span className="font-normal text-subtle-foreground">—</span>}
      </dd>
    </div>
  );
}
