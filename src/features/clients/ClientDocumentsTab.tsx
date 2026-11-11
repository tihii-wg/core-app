import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import type { Client, Invoice, InvoiceStatus } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { InvoiceStatusBadge } from "../../ui/StatusBadge";
import { InvoiceDetailPanel } from "../invoices/InvoiceDetailPanel";
import { useGetInvoices } from "../invoices/useGetInvoices";
import { useUpdateInvoiceStatus } from "../invoices/useUpdateInvoiceStatus";
import { AttachmentPreviewDialog, AttachmentThumb } from "../orders/OrderAttachmentsSection";
import { formatAttachmentBytes, type OrderAttachment } from "../orders/orderAttachments";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { currentIntlLocale } from "../../i18n";
import type { ClientOrderSummary } from "./clientOrders";
import { useClientOrderAttachments } from "./useClientOrderAttachments";

type ClientDocumentsTabProps = {
  client: Client;
  clientOrders: ClientOrderSummary[];
  onOpenOrder?: (orderId: string) => void;
};

/**
 * Invoices of the client + files of the client's orders. Mounted only while the Documents tab is active,
 * so the invoice query and attachment fetch are lazy.
 *
 * Invoices match when `client_id` or `payer_client_id` equals this client.
 */
export function ClientDocumentsTab({ client, clientOrders, onOpenOrder }: ClientDocumentsTabProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const { invoices, isLoading: invoicesLoading, error: invoicesError } = useGetInvoices({ enabled: true });
  const updateStatus = useUpdateInvoiceStatus();
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);
  const [preview, setPreview] = useState<OrderAttachment | null>(null);

  const clientInvoices = useMemo(
    () =>
      invoices
        .filter((invoice) => invoice.clientId === client.id || invoice.payerClientId === client.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.invoiceNumber.localeCompare(a.invoiceNumber)),
    [invoices, client.id],
  );

  const orderIds = useMemo(() => clientOrders.map((order) => order.id), [clientOrders]);
  const {
    attachments,
    isLoading: filesLoading,
    error: filesError,
    refetch: refetchFiles,
  } = useClientOrderAttachments(client.id, orderIds, { enabled: true });

  const filesByOrder = useMemo(() => {
    const groups: { order: ClientOrderSummary; files: OrderAttachment[] }[] = [];
    for (const order of clientOrders) {
      const files = attachments.filter((attachment) => attachment.orderId === order.id);
      if (files.length > 0) groups.push({ order, files });
    }
    return groups;
  }, [clientOrders, attachments]);

  function handleStatusChange(invoice: Invoice, status: InvoiceStatus) {
    if (updateStatus.isPending) return;
    updateStatus.mutate({ invoiceId: invoice.id, status });
  }

  return (
    <div className="space-y-6" data-testid="client-documents-tab">
      <section className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">
          {t("clients.detail.documents.invoices")}
        </h3>
        {invoicesLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : invoicesError ? (
          <p className="text-sm text-destructive">{t("clients.detail.documents.invoicesLoadFailed")}</p>
        ) : clientInvoices.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
            <FileText aria-hidden="true" className="mx-auto size-5 text-subtle-foreground" />
            <p className="mt-2 text-[13px] font-medium text-foreground">{t("clients.detail.documents.noInvoices")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {clientInvoices.map((invoice) => (
              <li key={invoice.id}>
                <button
                  type="button"
                  onClick={() => setOpenInvoiceId(invoice.id)}
                  className="flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium text-primary tabular-nums">{invoice.invoiceNumber}</span>
                      <InvoiceStatusBadge status={invoice.status} />
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                      {[
                        invoice.createdAt,
                        invoice.orderNumber ? t("clients.detail.documents.invoiceOrder", { number: invoice.orderNumber }) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-medium text-foreground tabular-nums">{formatMoney(invoice.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="client-order-files-heading">
        <h3
          id="client-order-files-heading"
          className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground"
        >
          {t("clients.detail.tabs.orderFiles")}
        </h3>
        {filesLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : filesError ? (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
            <p className="text-sm font-medium text-foreground">{t("clients.detail.documents.filesLoadFailed")}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refetchFiles()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : filesByOrder.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
            <p className="text-[13px] font-medium text-foreground">{t("clients.detail.documents.noFiles")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filesByOrder.map(({ order, files }) => (
              <div key={order.id} className="space-y-2" data-testid="client-order-files-group">
                {onOpenOrder ? (
                  <button
                    type="button"
                    onClick={() => onOpenOrder(order.id)}
                    className="text-sm font-medium text-primary tabular-nums hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                  >
                    {order.orderNumber}
                  </button>
                ) : (
                  <p className="text-sm font-medium text-primary tabular-nums">{order.orderNumber}</p>
                )}
                <ul className="space-y-2">
                  {files.map((file) => (
                    <li
                      key={file.id}
                      className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card p-2.5 shadow-xs"
                    >
                      <AttachmentThumb attachment={file} onOpen={() => setPreview(file)} />
                      <div className="min-w-0 flex-1">
                        <p className="break-all text-sm font-medium text-foreground" title={file.fileName}>
                          {file.fileName}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                          {file.mimeType || "—"} · {formatAttachmentBytes(file.fileSize, currentIntlLocale())}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <AttachmentPreviewDialog attachment={preview} open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)} />

      <InvoiceDetailPanel
        invoiceId={openInvoiceId}
        onClose={() => setOpenInvoiceId(null)}
        isUpdating={updateStatus.isPending}
        onStatusChange={handleStatusChange}
      />
    </div>
  );
}
