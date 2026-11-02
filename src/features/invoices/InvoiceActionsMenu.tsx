import { useState } from "react";
import { AlertTriangle, CircleCheck, EllipsisVertical, RotateCcw, Send, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../ui/DropdownMenu";
import type { Invoice, InvoiceStatus } from "../../lib/types";
import { isErroneousInvoiceStatus } from "../../services/apiInvoices";
import { DeleteErroneousInvoiceDialog } from "./DeleteErroneousInvoiceDialog";
import { MarkErroneousInvoiceDialog } from "./MarkErroneousInvoiceDialog";

type InvoiceActionsMenuProps = {
  invoice: Invoice;
  isUpdating?: boolean;
  onStatusChange: (invoice: Invoice, status: InvoiceStatus) => void;
  onErroneousDeleted?: () => void;
  /** Extra classes for the trigger (e.g. a larger touch target on mobile cards). */
  triggerClassName?: string;
};

// Clicks are stopped so the menu can sit inside a clickable table row (see OrderActionsMenu).
export function InvoiceActionsMenu({
  invoice,
  isUpdating = false,
  onStatusChange,
  onErroneousDeleted,
  triggerClassName,
}: InvoiceActionsMenuProps) {
  const { t } = useTranslation();
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const [markOpen, setMarkOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const erroneous = isErroneousInvoiceStatus(invoice.status);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" className={triggerClassName} aria-label={t("invoices.actions.menuLabel", { number: invoice.invoiceNumber })} onClick={stop}>
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" onClick={stop}>
          {!erroneous && invoice.status === "draft" && (
            <DropdownMenuItem disabled={isUpdating} onSelect={() => onStatusChange(invoice, "sent")}>
              <Send />
              {t("invoices.actions.markSent")}
            </DropdownMenuItem>
          )}
          {!erroneous &&
            (invoice.status === "paid" ? (
              <DropdownMenuItem disabled={isUpdating} onSelect={() => onStatusChange(invoice, "sent")}>
                <RotateCcw />
                {t("invoices.actions.markUnpaid")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled={isUpdating} onSelect={() => onStatusChange(invoice, "paid")}>
                <CircleCheck />
                {t("invoices.actions.markPaid")}
              </DropdownMenuItem>
            ))}
          {!erroneous && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={isUpdating} onSelect={() => setMarkOpen(true)}>
                <AlertTriangle />
                {t("invoices.actions.markErroneous")}
              </DropdownMenuItem>
            </>
          )}
          {erroneous && (
            <DropdownMenuItem disabled={isUpdating} onSelect={() => setDeleteOpen(true)}>
              <Trash2 />
              {t("invoices.actions.deleteErroneous")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <MarkErroneousInvoiceDialog invoice={markOpen ? invoice : null} onClose={() => setMarkOpen(false)} />
      <DeleteErroneousInvoiceDialog
        invoice={deleteOpen ? invoice : null}
        onClose={() => setDeleteOpen(false)}
        onDeleted={onErroneousDeleted}
      />
    </>
  );
}
