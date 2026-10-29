import { useState } from "react";
import { Check, EllipsisVertical, Eye, FileCheck2, FilePlus2, FileX2, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/Dialog";
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
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageWorkspace } from "../workspaces/workspaceRoles";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { isOrderPaidLocked, isPaidStatusOptionBlocked } from "./taxInvoice";
import { useDeleteOrder } from "./useDeleteOrder";

type OrderActionsMenuProps = {
  order: Order;
  /** Number of the invoice already created from this order, if any. */
  invoiceNumber?: string;
  /** Ledger rows with this order_id (shown in the delete confirmation). */
  linkedPaymentCount?: number;
  invoicesUnavailable?: boolean;
  isCreatingInvoice?: boolean;
  isStatusUpdating?: boolean;
  /** When true, Paid is disabled for legal-entity orders without a saved tax invoice number. */
  requireTaxInvoiceNumber?: boolean;
  onView: (order: Order) => void;
  onEdit: (order: Order) => void;
  onStatusChange: (order: Order, status: OrderStatus) => void;
  onCreateInvoice: (order: Order) => void;
  /** Called after a successful delete so the parent can close detail panels. */
  onDeleted?: (orderId: string) => void;
  /** Extra classes for the trigger (e.g. a larger touch target on mobile cards). */
  triggerClassName?: string;
};

// The menu sits inside a clickable table row and React events bubble through the portal, so clicks
// are stopped here to keep the row from opening the order panel. Non-modal so the edit dialog
// opened from it gets focus and pointer events back.
export function OrderActionsMenu({
  order,
  invoiceNumber,
  linkedPaymentCount = 0,
  invoicesUnavailable = false,
  isCreatingInvoice = false,
  isStatusUpdating = false,
  requireTaxInvoiceNumber = false,
  onView,
  onEdit,
  onStatusChange,
  onCreateInvoice,
  onDeleted,
  triggerClassName,
}: OrderActionsMenuProps) {
  const { t } = useTranslation();
  const { workflow } = useIndustryWorkflow();
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  // Owner membership role only — admin/manager stay locked. API re-checks owner_id.
  const isWorkspaceOwner = canManageWorkspace(useActiveWorkspaceRole());
  const { canWrite } = useWorkspaceSubscription();
  const paidLocked = isOrderPaidLocked(order, isWorkspaceOwner);
  const paidBlocked = isPaidStatusOptionBlocked(order, requireTaxInvoiceNumber);
  const deleteOrder = useDeleteOrder();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const hasInvoice = Boolean(invoiceNumber);
  const paymentCount = Math.max(0, linkedPaymentCount);

  return (
    <>
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
          <DropdownMenuLabel>
            {paidLocked
              ? t("orders.actions.statusLocked")
              : isStatusUpdating
                ? t("orders.actions.updatingStatus")
                : t("orders.actions.changeStatus")}
          </DropdownMenuLabel>
          {ORDER_STATUSES.map((status) => {
            const current = status === order.status;
            const blockedPaid = status === "paid" && paidBlocked && !current;
            const locked = paidLocked || blockedPaid;
            return (
              <DropdownMenuItem
                key={status}
                disabled={current || isStatusUpdating || locked}
                title={
                  paidLocked
                    ? t("orders.errors.paidStatusLocked")
                    : blockedPaid
                      ? t("orders.taxInvoice.requiredHint")
                      : undefined
                }
                onSelect={() => {
                  if (locked) return;
                  onStatusChange(order, status);
                }}
              >
                {current ? <Check /> : <span className="size-4" aria-hidden />}
                {industryOrderStatusLabel(workflow, status)}
              </DropdownMenuItem>
            );
          })}
          {paidLocked ? (
            <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {t("orders.actions.paidStatusImmutable")}
            </p>
          ) : paidBlocked ? (
            <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {t("orders.taxInvoice.paidRequiresNumber")}
            </p>
          ) : null}

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

          {canWrite ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={hasInvoice || deleteOrder.isPending}
                title={hasInvoice ? t("orders.errors.cannotDeleteWithInvoice") : undefined}
                onSelect={() => {
                  if (hasInvoice) return;
                  setConfirmDeleteOpen(true);
                }}
              >
                <Trash2 />
                {t("orders.actions.delete")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent onClick={stop}>
          <DialogHeader>
            <DialogTitle>{t("orders.delete.title")}</DialogTitle>
            <DialogDescription>
              {paymentCount > 0
                ? t("orders.delete.descriptionWithPayments", {
                    number: order.orderNumber || t("orders.emptyOrderLabel"),
                    count: paymentCount,
                  })
                : t("orders.delete.description", { number: order.orderNumber || t("orders.emptyOrderLabel") })}
            </DialogDescription>
          </DialogHeader>
          {hasInvoice ? (
            <p className="text-sm text-destructive" role="alert">
              {t("orders.errors.cannotDeleteWithInvoice")}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDeleteOpen(false)} disabled={deleteOrder.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteOrder.isPending || hasInvoice}
              onClick={() => {
                if (hasInvoice) return;
                void deleteOrder.mutateAsync(order.id).then(() => {
                  setConfirmDeleteOpen(false);
                  onDeleted?.(order.id);
                });
              }}
            >
              {deleteOrder.isPending
                ? t("common.deleting")
                : paymentCount > 0
                  ? t("orders.delete.confirmWithPayments", { count: paymentCount })
                  : t("orders.actions.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
