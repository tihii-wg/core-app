import { EllipsisVertical, FileCheck2, FilePlus2, FileX2, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("orders.actions.menuLabel", { number: order.orderNumber })} onClick={stop}>
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" onClick={stop}>
        <DropdownMenuItem onSelect={() => onEdit(order)}>
          <Pencil />
          {t("common.edit")}
        </DropdownMenuItem>
        {invoiceNumber ? (
          <DropdownMenuItem disabled>
            <FileCheck2 />
            <span className="truncate">{t("orders.actions.invoiceAlreadyCreated", { number: invoiceNumber })}</span>
          </DropdownMenuItem>
        ) : invoicesUnavailable ? (
          <DropdownMenuItem disabled>
            <FileX2 />
            {t("orders.actions.invoicesNotSetUp")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled={isCreatingInvoice} onSelect={() => onCreateInvoice(order)}>
            <FilePlus2 />
            {isCreatingInvoice ? t("orders.actions.creatingInvoice") : t("orders.actions.createInvoice")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
