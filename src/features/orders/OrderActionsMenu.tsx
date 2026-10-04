import { EllipsisVertical, FileCheck2, FilePlus2, FileX2, Pencil } from "lucide-react";
import { Button } from "../../ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/DropdownMenu";
import type { Order } from "../../lib/types";

type OrderActionsMenuProps = {
  order: Order;
  /** Number of the invoice already created from this order, if any. */
  invoiceNumber?: string;
  invoicesUnavailable?: boolean;
  isCreatingInvoice?: boolean;
  onEdit: (order: Order) => void;
  onCreateInvoice: (order: Order) => void;
};

// The menu sits inside a clickable table row and React events bubble through the portal, so clicks
// are stopped here to keep the row from opening the order panel. Non-modal so the edit dialog
// opened from it gets focus and pointer events back.
export function OrderActionsMenu({ order, invoiceNumber, invoicesUnavailable = false, isCreatingInvoice = false, onEdit, onCreateInvoice }: OrderActionsMenuProps) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for order ${order.orderNumber}`} onClick={stop}>
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" onClick={stop}>
        <DropdownMenuItem onSelect={() => onEdit(order)}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        {invoiceNumber ? (
          <DropdownMenuItem disabled>
            <FileCheck2 />
            <span className="truncate">Invoice {invoiceNumber} already created</span>
          </DropdownMenuItem>
        ) : invoicesUnavailable ? (
          <DropdownMenuItem disabled>
            <FileX2 />
            Invoices are not set up yet
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled={isCreatingInvoice} onSelect={() => onCreateInvoice(order)}>
            <FilePlus2 />
            {isCreatingInvoice ? "Creating invoice..." : "Create Invoice"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
