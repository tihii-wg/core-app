import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { Order } from "../../../lib/types";
import type { LedgerPayment } from "../../finance/paymentTypes";
import { Button } from "../../../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../ui/Dialog";
import { PaymentFormDialog } from "../../finance/PaymentFormDialog";
import { recordableOrderBalance } from "../minPaidStatusGuard";
import AddOrderMaterialDialog, { type AddOrderMaterialPrefill } from "../AddOrderMaterialDialog";
import ChangeOrderClientDialog from "../ChangeOrderClientDialog";
import { CloseOrderDialog } from "../CloseOrderDialog";
import { OrderCancelChainDialog } from "../OrderCancelChainDialog";
import { OrderCatalogLinkDialogs } from "../OrderCatalogLinkDialogs";

export type OrderDetailDialogsProps = {
  selectedOrder: Order | null;
  confirmDeleteOpen: boolean;
  setConfirmDeleteOpen: (open: boolean) => void;
  deletePending: boolean;
  deleteBlockedReason: string | null;
  linkedPaymentCount: number;
  onConfirmDelete: () => void;
  changeClientOpen: boolean;
  setChangeClientOpen: (open: boolean) => void;
  hasInvoice: boolean;
  sheetContentRef: RefObject<HTMLDivElement | null>;
  onOrderUpdated: (order: Order) => void;
  closeOpen: boolean;
  setCloseOpen: (open: boolean) => void;
  payments: LedgerPayment[];
  formatMoney: (n: number) => string;
  canRecordPayment: boolean;
  cancelOpen: boolean;
  setCancelOpen: (open: boolean) => void;
  onDeleted?: (orderId: string) => void;
  recordPaymentOpen: boolean;
  setRecordPaymentOpen: (open: boolean) => void;
  addMaterialOpen: boolean;
  setAddMaterialOpen: (open: boolean) => void;
  addMaterialPrefill: AddOrderMaterialPrefill | null;
  setAddMaterialPrefill: (prefill: AddOrderMaterialPrefill | null) => void;
  showAddMaterial: boolean;
  onPendingMaterials: (drafts: import("../../../lib/types").OrderMaterial[]) => () => void;
  catalogServiceId: string | null;
  catalogInventoryId: string | null;
  onCloseService: () => void;
  onCloseInventory: () => void;
};

export function OrderDetailDialogs(props: OrderDetailDialogsProps) {
  const { t } = useTranslation();
  const {
    selectedOrder,
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    deletePending,
    deleteBlockedReason,
    linkedPaymentCount,
    onConfirmDelete,
    changeClientOpen,
    setChangeClientOpen,
    hasInvoice,
    sheetContentRef,
    onOrderUpdated,
    closeOpen,
    setCloseOpen,
    payments,
    formatMoney,
    canRecordPayment,
    cancelOpen,
    setCancelOpen,
    onDeleted,
    recordPaymentOpen,
    setRecordPaymentOpen,
    addMaterialOpen,
    setAddMaterialOpen,
    addMaterialPrefill,
    setAddMaterialPrefill,
    showAddMaterial,
    onPendingMaterials,
    catalogServiceId,
    catalogInventoryId,
    onCloseService,
    onCloseInventory,
  } = props;

  return (
    <>
      {selectedOrder ? (
        <Dialog
          open={confirmDeleteOpen}
          onOpenChange={(open) => {
            if (deletePending) return;
            setConfirmDeleteOpen(open);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("orders.delete.title")}</DialogTitle>
              <DialogDescription>
                {linkedPaymentCount > 0
                  ? t("orders.delete.descriptionWithPayments", {
                      number: selectedOrder.orderNumber || t("orders.emptyOrderLabel"),
                      count: linkedPaymentCount,
                    })
                  : t("orders.delete.descriptionCancelledWithStock", {
                      number: selectedOrder.orderNumber || t("orders.emptyOrderLabel"),
                    })}
              </DialogDescription>
              <p className="text-sm text-muted-foreground">{t("orders.cancelFinance.deleteRemovesAll")}</p>
            </DialogHeader>
            {deleteBlockedReason ? (
              <p className="text-sm text-destructive" role="alert">
                {deleteBlockedReason}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmDeleteOpen(false)}
                disabled={deletePending}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deletePending || Boolean(deleteBlockedReason)}
                onClick={() => {
                  if (deleteBlockedReason || deletePending) return;
                  onConfirmDelete();
                }}
              >
                {deletePending
                  ? t("common.deleting")
                  : linkedPaymentCount > 0
                    ? t("orders.delete.confirmWithPayments", { count: linkedPaymentCount })
                    : t("orders.actions.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <ChangeOrderClientDialog
        order={selectedOrder}
        open={changeClientOpen}
        onOpenChange={setChangeClientOpen}
        hasInvoice={hasInvoice}
        portalContainer={sheetContentRef.current}
        onChanged={onOrderUpdated}
      />

      <CloseOrderDialog
        order={selectedOrder}
        open={closeOpen}
        onOpenChange={setCloseOpen}
        payments={payments}
        formatMoney={formatMoney}
        canRecordPayment={canRecordPayment}
        onOrderRefreshed={onOrderUpdated}
        onClosed={(result) => {
          if (!selectedOrder) return;
          onOrderUpdated({
            ...selectedOrder,
            status: "closed",
            closedAt: result.closed_at ?? selectedOrder.closedAt,
            customStatusId: result.customStatusId,
            customStatus: result.customStatus,
          });
        }}
      />

      <OrderCancelChainDialog
        order={selectedOrder}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        onOrderUpdated={onOrderUpdated}
        onDeleted={onDeleted}
      />

      {recordPaymentOpen && selectedOrder ? (
        <PaymentFormDialog
          open
          onOpenChange={setRecordPaymentOpen}
          target="order"
          order={selectedOrder}
          orderId={selectedOrder.id}
          balance={recordableOrderBalance(selectedOrder, payments)}
          onOrderUpdated={onOrderUpdated}
        />
      ) : null}
      {selectedOrder ? (
        <AddOrderMaterialDialog
          open={addMaterialOpen && showAddMaterial}
          onOpenChange={(open) => {
            setAddMaterialOpen(open);
            if (!open) setAddMaterialPrefill(null);
          }}
          order={selectedOrder}
          onAdded={onOrderUpdated}
          onPending={onPendingMaterials}
          prefill={addMaterialPrefill}
        />
      ) : null}
      <OrderCatalogLinkDialogs
        serviceId={catalogServiceId}
        inventoryItemId={catalogInventoryId}
        onCloseService={onCloseService}
        onCloseInventory={onCloseInventory}
      />
    </>
  );
}
