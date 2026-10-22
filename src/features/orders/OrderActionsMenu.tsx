import { Check, EllipsisVertical, Eye, FileCheck2, FilePlus2, FileX2, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/DropdownMenu";
import type { Order, OrderStatus } from "../../lib/types";
import { industryOrderStatusLabel, ORDER_STATUSES } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";

type OrderActionsMenuProps = {
  order: Order;
  /** Number of the invoice already created from this order, if any. */
  invoiceNumber?: string;
  invoicesUnavailable?: boolean;
  isCreatingInvoice?: boolean;
  isStatusUpdating?: boolean;
  onView: (order: Order) => void;
  onEdit: (order: Order) => void;
  onStatusChange: (order: Order, status: OrderStatus) => void;
  onCreateInvoice: (order: Order) => void;
  /** Extra classes for the trigger (e.g. a larger touch target on mobile cards). */
  triggerClassName?: string;
};

// The menu sits inside a clickable table row and React events bubble through the portal, so clicks
// are stopped here to keep the row from opening the order panel. Non-modal so the edit dialog
// opened from it gets focus and pointer events back.
export function OrderActionsMenu({
  order,
  invoiceNumber,
  invoicesUnavailable = false,
  isCreatingInvoice = false,
  isStatusUpdating = false,
  onView,
  onEdit,
  onStatusChange,
  onCreateInvoice,
  triggerClassName,
}: OrderActionsMenuProps) {
  const { t } = useTranslation();
  const { workflow } = useIndustryWorkflow();
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" className={triggerClassName} aria-label={t("orders.actions.menuLabel", { number: order.orderNumber })} onClick={stop}>
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" onClick={stop}>
        <DropdownMenuItem onSelect={() => onView(order)}>
          <Eye />
          {t("orders.actions.viewDetails")}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{isStatusUpdating ? t("orders.actions.updatingStatus") : t("orders.actions.changeStatus")}</DropdownMenuLabel>
        {ORDER_STATUSES.map((status) => {
          const current = status === order.status;
          return (
            <DropdownMenuItem
              key={status}
              disabled={current || isStatusUpdating}
              onSelect={() => onStatusChange(order, status)}
            >
              {current ? <Check /> : <span className="size-4" aria-hidden />}
              {industryOrderStatusLabel(workflow, status)}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />

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
