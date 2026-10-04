import { CircleCheck, EllipsisVertical, RotateCcw, Send } from "lucide-react";
import { Button } from "../../ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/DropdownMenu";
import type { Invoice, InvoiceStatus } from "../../lib/types";

type InvoiceActionsMenuProps = {
  invoice: Invoice;
  isUpdating?: boolean;
  onStatusChange: (invoice: Invoice, status: InvoiceStatus) => void;
};

// Clicks are stopped so the menu can sit inside a clickable table row (see OrderActionsMenu).
export function InvoiceActionsMenu({ invoice, isUpdating = false, onStatusChange }: InvoiceActionsMenuProps) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for invoice ${invoice.invoiceNumber}`} onClick={stop}>
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={stop}>
        {invoice.status === "draft" && (
          <DropdownMenuItem disabled={isUpdating} onSelect={() => onStatusChange(invoice, "sent")}>
            <Send />
            Mark as sent
          </DropdownMenuItem>
        )}
        {invoice.status === "paid" ? (
          <DropdownMenuItem disabled={isUpdating} onSelect={() => onStatusChange(invoice, "sent")}>
            <RotateCcw />
            Mark as unpaid
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled={isUpdating} onSelect={() => onStatusChange(invoice, "paid")}>
            <CircleCheck />
            Mark as paid
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
