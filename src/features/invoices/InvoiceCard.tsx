import type { Invoice, InvoiceStatus } from "../../lib/types";
import { InvoiceStatusBadge } from "../../ui/StatusBadge";
import { InvoiceActionsMenu } from "./InvoiceActionsMenu";
import { InvoicePrintButton } from "./InvoicePrintButton";

type InvoiceCardProps = {
  invoice: Invoice;
  isUpdating?: boolean;
  formatMoney: (value: number) => string;
  onView: (invoice: Invoice) => void;
  onStatusChange: (invoice: Invoice, status: InvoiceStatus) => void;
};

/**
 * Compact phone layout for one invoice (below the md breakpoint). The whole
 * surface opens the invoice detail; print and the actions menu stay
 * independent controls and never trigger the card click.
 */
export function InvoiceCard({ invoice, isUpdating = false, formatMoney, onView, onStatusChange }: InvoiceCardProps) {
  return (
    <article
      onClick={() => onView(invoice)}
      className="cursor-pointer rounded-lg border border-border bg-card p-3 shadow-xs transition-colors hover:bg-accent/40 active:bg-accent/60"
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="break-all font-semibold text-primary tabular-nums">{invoice.invoiceNumber}</p>
          <p className="mt-0.5 truncate font-medium text-foreground" title={invoice.clientName}>
            {invoice.clientName || "—"}
          </p>
          {invoice.orderNumber ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">{invoice.orderNumber}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
          <InvoicePrintButton invoice={invoice} triggerClassName="size-10" />
          <InvoiceActionsMenu invoice={invoice} isUpdating={isUpdating} onStatusChange={onStatusChange} triggerClassName="size-10" />
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-2.5">
        <InvoiceStatusBadge status={invoice.status} />
        <span className="ml-auto text-right">
          <span className="block font-semibold tabular-nums text-foreground">{formatMoney(invoice.total)}</span>
          <span className="block text-[11px] tabular-nums text-muted-foreground">{invoice.createdAt}</span>
        </span>
      </div>
    </article>
  );
}
