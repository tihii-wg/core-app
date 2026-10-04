import { CircleCheck, RotateCcw, Send } from "lucide-react";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/EmptyState";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { Spinner } from "../../ui/Spinner";
import { InvoiceStatusBadge } from "../../ui/StatusBadge";
import type { Invoice, InvoiceStatus } from "../../lib/types";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useGetInvoice } from "./useGetInvoices";

type InvoiceDetailPanelProps = {
  invoiceId: string | null;
  onClose: () => void;
  isUpdating: boolean;
  onStatusChange: (invoice: Invoice, status: InvoiceStatus) => void;
};

export function InvoiceDetailPanel({ invoiceId, onClose, isUpdating, onStatusChange }: InvoiceDetailPanelProps) {
  const { invoice, isLoading, error } = useGetInvoice(invoiceId);
  const { formatMoney } = useWorkspaceMoney();

  return (
    <Sheet open={invoiceId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-12">
          <SheetTitle className="flex min-w-0 flex-wrap items-center gap-2 tabular-nums">
            {invoice?.invoiceNumber ?? "Invoice"}
            {invoice && <InvoiceStatusBadge status={invoice.status} />}
          </SheetTitle>
          <SheetDescription className="sr-only">Invoice details, the services it bills and its payment status.</SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="flex justify-center py-14">
            <Spinner className="size-5" />
          </div>
        )}

        {error && <ErrorState title="Could not load this invoice" description={error.message} />}

        {invoice && (
          <div className="space-y-5 px-5 py-5">
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/50 p-4">
              <div className="min-w-0">
                <h3 className="text-xs font-medium text-muted-foreground">Bill to</h3>
                <p className="mt-1 font-medium [overflow-wrap:anywhere] text-foreground">{invoice.clientName || "—"}</p>
              </div>
              <div className="shrink-0 text-right">
                <h3 className="text-xs font-medium text-muted-foreground">Total</h3>
                <p className="mt-1 text-xl font-semibold tracking-tight text-foreground tabular-nums">{formatMoney(invoice.total)}</p>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
              <DetailItem label="Order" value={invoice.orderNumber} />
              <DetailItem label="Created" value={invoice.createdAt} />
              <DetailItem label="Device" value={invoice.device} />
              <DetailItem label="Car Number" value={invoice.carNumber} />
              <DetailItem label="VIN" value={invoice.vin} mono />
              <DetailItem label={invoice.status === "paid" ? "Paid On" : "Due Date"} value={invoice.status === "paid" ? invoice.paidAt : invoice.dueDate} />
              {invoice.description && (
                <div className="col-span-2">
                  <dt className="text-xs font-medium text-muted-foreground">Description</dt>
                  <dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground">{invoice.description}</dd>
                </div>
              )}
            </dl>

            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Service</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Price</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoice.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 [overflow-wrap:anywhere] text-foreground">{item.serviceName}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{item.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatMoney(item.price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatMoney(item.price * item.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border font-medium">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right text-muted-foreground">
                      Total
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatMoney(invoice.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border pt-5">
              {invoice.status === "draft" && (
                <Button variant="outline" size="sm" disabled={isUpdating} onClick={() => onStatusChange(invoice, "sent")}>
                  <Send />
                  Mark as sent
                </Button>
              )}
              {invoice.status === "paid" ? (
                <Button variant="outline" size="sm" disabled={isUpdating} onClick={() => onStatusChange(invoice, "sent")}>
                  <RotateCcw />
                  Mark as unpaid
                </Button>
              ) : (
                <Button size="sm" disabled={isUpdating} onClick={() => onStatusChange(invoice, "paid")}>
                  <CircleCheck />
                  Mark as paid
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
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
