import { useState } from "react";
import { Check, CircleX, EllipsisVertical, Eye, FileCheck2, FilePlus2, FileX2, Link2, Lock, Pencil, Printer, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { Button } from "../../ui/Button";
import { createPublicOrderLink, publicOrderStatusUrl } from "../../services/apiPublicLinks";
import { MissingRpcError } from "../../services/missingRpc";
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
import { industryOrderStatusLabel } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { useIsWorkspaceOwnerId } from "../workspaces/useIsWorkspaceOwnerId";
import { canManageWorkspace } from "../workspaces/workspaceRoles";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { useGetDocumentTemplates } from "../documents/useGetDocumentTemplates";
import { usePrintOrderDocument } from "../documents/usePrintOrderDocument";
import { isOrderPaidLocked, isPaidStatusOptionBlocked } from "./taxInvoice";
import { useDeleteOrder } from "./useDeleteOrder";
import { isOrderFormallyClosed } from "./orderLifecycle";
import { CloseOrderDialog } from "./CloseOrderDialog";
import { useCancelOrder } from "./useCloseOrder";
import { useGetPayments } from "../finance/usePayments";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useGetStatusDefinitions } from "../statuses/useGetStatusDefinitions";
import { useMoveOrderOnBoard } from "./useMoveOrderOnBoard";
import {
  resolveCurrentUnifiedStatus,
  resolveUnifiedStatusSelection,
  unifiedStatusOptions,
} from "./unifiedOrderStatus";
import { activePaymentsBlockingOrderDelete, orderHasCancelSemantic } from "./orderDeletionEligibility";
import {
  canOfferCancelOrderAction,
  canOfferDeleteClosedOrderAction,
} from "./closedOrderPermissions";
import { useClosedOrderActionPermissions } from "./useClosedOrderPermissions";

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
  /** Merge lifecycle updates (close/cancel) into local detail state when open. */
  onOrderUpdated?: (order: Order) => void;
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
  onOrderUpdated,
  triggerClassName,
}: OrderActionsMenuProps) {
  const { t } = useTranslation();
  const { workflow } = useIndustryWorkflow();
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  // Paid unlock uses membership owner role; closed-order cancel/delete uses owner_id.
  const isWorkspaceOwner = canManageWorkspace(useActiveWorkspaceRole());
  const isOwnerByOwnerId = useIsWorkspaceOwnerId();
  const { canWrite } = useWorkspaceSubscription();
  const paidLocked = isOrderPaidLocked(order, isWorkspaceOwner);
  const paidBlocked = isPaidStatusOptionBlocked(order, requireTaxInvoiceNumber);
  const deleteOrder = useDeleteOrder();
  const printOrder = usePrintOrderDocument();
  const { data: templates = [] } = useGetDocumentTemplates();
  const printTemplates = templates.filter((template) => template.isActive && template.bodyHtml.trim());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [copyingPublicLink, setCopyingPublicLink] = useState(false);
  const cancelOrderMutation = useCancelOrder();
  const { payments } = useGetPayments();
  const { formatMoney } = useWorkspaceMoney();
  const formallyClosed = isOrderFormallyClosed(order);
  const closedOrderPerms = useClosedOrderActionPermissions();
  const canManageClosedContent = closedOrderPerms.canManageClosedContent;
  const statusLockedForMenu =
    (formallyClosed && !canManageClosedContent) || (order.status === "cancelled" && !formallyClosed);
  const { data: orderStatusDefinitions = [] } = useGetStatusDefinitions("order");
  const { mutate: moveOnBoard, isPending: isUnifiedStatusUpdating } = useMoveOrderOnBoard();
  const statusOptions = unifiedStatusOptions(orderStatusDefinitions, (status) =>
    industryOrderStatusLabel(workflow, status),
  );
  const currentUnifiedStatus = resolveCurrentUnifiedStatus(order, statusOptions);
  const statusBusy = isStatusUpdating || isUnifiedStatusUpdating;
  const hasInvoice = Boolean(invoiceNumber);
  const paymentCount = Math.max(0, linkedPaymentCount);
  const isCancelledForDelete = orderHasCancelSemantic(order, orderStatusDefinitions);
  const activePaymentsBlockingDelete = activePaymentsBlockingOrderDelete(payments, order.id);
  const deleteBlockedReason = hasInvoice
    ? t("orders.errors.cannotDeleteWithInvoice")
    : !isCancelledForDelete
      ? t("orders.delete.requireCancelled")
      : activePaymentsBlockingDelete.length > 0
        ? t("orders.errors.cannotDeleteWithActivePayments")
        : !canOfferDeleteClosedOrderAction({
              order,
              workspaceRole: closedOrderPerms.role,
              grants: closedOrderPerms.grants,
              isOwnerByOwnerId,
              ownerCanManageClosedOrders: closedOrderPerms.ownerCanManageClosedOrders,
            })
          ? t("orders.errors.deleteClosedForbidden")
          : null;
  const showOpenLifecycleActions = canWrite && !formallyClosed && order.status !== "cancelled";
  const showCancelClosedAction = canOfferCancelOrderAction({
    order,
    canWrite,
    workspaceRole: closedOrderPerms.role,
    grants: closedOrderPerms.grants,
    isOwnerByOwnerId,
    ownerCanManageClosedOrders: closedOrderPerms.ownerCanManageClosedOrders,
  }) && formallyClosed;

  async function copyPublicStatusLink() {
    if (copyingPublicLink) return;
    setCopyingPublicLink(true);
    const toastId = "public-order-link";
    try {
      const link = await createPublicOrderLink(order.id);
      const url = publicOrderStatusUrl(link.token, i18n.language);
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        throw new Error("clipboard unavailable");
      }
      toast.success(t("orders.actions.publicLinkCopied"), { id: toastId });
    } catch (error) {
      if (error instanceof MissingRpcError) {
        toast.error(error.message || t("orders.actions.publicLinkUnavailable"), { id: toastId });
      } else {
        const message = error instanceof Error && error.message ? error.message : t("orders.actions.publicLinkCopyFailed");
        toast.error(message, { id: toastId });
      }
    } finally {
      setCopyingPublicLink(false);
    }
  }

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
            {statusLockedForMenu || paidLocked
              ? t("orders.actions.statusLocked")
              : statusBusy
                ? t("orders.actions.updatingStatus")
                : t("orders.actions.changeStatus")}
          </DropdownMenuLabel>
          {statusLockedForMenu ? (
            <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {order.status === "cancelled"
                ? t("orders.lifecycle.errors.orderAlreadyCancelled")
                : t("orders.lifecycle.errors.orderAlreadyClosed")}
            </p>
          ) : (
            statusOptions.map((option) => {
              const current = currentUnifiedStatus?.id === option.id;
              const blockedPaid = option.systemStatus === "paid" && paidBlocked && !current;
              const locked = paidLocked || blockedPaid;
              return (
                <DropdownMenuItem
                  key={option.id}
                  disabled={current || statusBusy || locked}
                  title={
                    paidLocked
                      ? t("orders.errors.paidStatusLocked")
                      : blockedPaid
                        ? t("orders.taxInvoice.requiredHint")
                        : undefined
                  }
                  onSelect={() => {
                    if (locked) return;
                    const move = resolveUnifiedStatusSelection(order, option, {
                      allowManageClosed: canManageClosedContent,
                    });
                    if (!move) return;
                    if (option.kind === "definition" || move.customStatusId !== null || order.customStatusId) {
                      moveOnBoard({
                        orderId: order.id,
                        status: move.status,
                        customStatusId: move.customStatusId,
                        currentStatus: order.status,
                      });
                      return;
                    }
                    onStatusChange(order, move.status);
                  }}
                >
                  {current ? <Check /> : <span className="size-4" aria-hidden />}
                  {option.color ? (
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-border"
                      style={{ backgroundColor: option.color }}
                    />
                  ) : null}
                  {option.name}
                </DropdownMenuItem>
              );
            })
          )}
          {paidLocked && !statusLockedForMenu ? (
            <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {t("orders.actions.paidStatusImmutable")}
            </p>
          ) : paidBlocked && !statusLockedForMenu ? (
            <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {t("orders.taxInvoice.paidRequiresNumber")}
            </p>
          ) : null}

          {showOpenLifecycleActions ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setCloseOpen(true)}>
                <Lock />
                {t("orders.lifecycle.closeAction")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setCancelOpen(true)}>
                <CircleX />
                {t("orders.lifecycle.cancelAction")}
              </DropdownMenuItem>
            </>
          ) : null}
          {showCancelClosedAction ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setCancelOpen(true)}>
                <CircleX />
                {t("orders.lifecycle.cancelAction")}
              </DropdownMenuItem>
            </>
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

          <DropdownMenuSeparator />
          {printTemplates.length === 0 ? (
            <DropdownMenuItem onSelect={() => toast.error(i18n.t("orders.print.unavailable"))}>
              <Printer />
              {t("orders.print.action")}
            </DropdownMenuItem>
          ) : (
            printTemplates.map((template) => (
              <DropdownMenuItem
                key={template.id}
                disabled={printOrder.isPending}
                onSelect={() => printOrder.mutate({ orderId: order.id, templateId: template.id })}
              >
                <Printer />
                <span className="truncate">{t("orders.print.withTemplate", { name: template.name })}</span>
              </DropdownMenuItem>
            ))
          )}
          {canWrite ? (
            <DropdownMenuItem disabled={copyingPublicLink} onSelect={() => void copyPublicStatusLink()}>
              <Link2 />
              {t("orders.actions.copyPublicLink")}
            </DropdownMenuItem>
          ) : null}

          {canWrite ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={Boolean(deleteBlockedReason) || deleteOrder.isPending}
                title={deleteBlockedReason ?? undefined}
                onSelect={() => {
                  if (deleteBlockedReason) return;
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
                : t("orders.delete.descriptionCancelledWithStock", {
                    number: order.orderNumber || t("orders.emptyOrderLabel"),
                  })}
            </DialogDescription>
          </DialogHeader>
          {deleteBlockedReason ? (
            <p className="text-sm text-destructive" role="alert">
              {deleteBlockedReason}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDeleteOpen(false)} disabled={deleteOrder.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteOrder.isPending || Boolean(deleteBlockedReason)}
              onClick={() => {
                if (deleteBlockedReason) return;
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

      <CloseOrderDialog
        order={order}
        open={closeOpen}
        onOpenChange={setCloseOpen}
        payments={payments}
        formatMoney={formatMoney}
        onClosed={(result) => {
          onOrderUpdated?.({
            ...order,
            status: "closed",
            closedAt: result.closed_at ?? order.closedAt,
            customStatusId: result.customStatusId,
            customStatus: result.customStatus,
          });
        }}
      />

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent onClick={stop}>
          <DialogHeader>
            <DialogTitle>{t("orders.lifecycle.cancelTitle")}</DialogTitle>
            <DialogDescription>{t("orders.lifecycle.cancelDescription", { number: order.orderNumber })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)} disabled={cancelOrderMutation.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={cancelOrderMutation.isPending}
              onClick={() => {
                cancelOrderMutation.mutate(order.id, {
                  onSuccess: (result) => {
                    setCancelOpen(false);
                    onOrderUpdated?.({
                      ...order,
                      status: "cancelled",
                      customStatusId: result.customStatusId,
                      customStatus: result.customStatus,
                      closedAt: result.closed_at ?? order.closedAt,
                    });
                  },
                });
              }}
            >
              {cancelOrderMutation.isPending ? t("common.saving") : t("orders.lifecycle.confirmCancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
