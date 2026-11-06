import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { EmptyState } from "../../ui/EmptyState";
import { Label } from "../../ui/Label";
import { Spinner } from "../../ui/Spinner";
import { OrderStatusBadge } from "../../ui/StatusBadge";
import type { InventoryItem, OrderStatus } from "../../lib/types";
import { languageFromPath } from "../../i18n/languages";
import { MissingRpcError } from "../../services/missingRpc";
import { getOrder } from "../../services/apiOrders";
import type { InventoryItemDeletePreview } from "../../services/apiInventory";
import { industryInventoryCopy } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import OrderDetailPanel from "../orders/OrderDetailPanel";
import { useOrderDetails } from "../orders/useOrderDetails";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { ordersListPath } from "../vehicles/vehicleRoutes";
import { useDeleteInventoryItem } from "./useDeleteInventoryItem";
import { useInventoryItemDeletePreview } from "./useInventoryItemDeletePreview";
import { usePurgeInventoryItem } from "./usePurgeInventoryItem";
import { useUpdateInventoryItem } from "./useUpdateInventoryItem";

type DeleteInventoryItemDialogProps = {
  item: InventoryItem | null;
  onClose: () => void;
  onDeleted?: (itemId: string) => void;
};

const ORDER_STATUSES = new Set<OrderStatus>([
  "new",
  "in-progress",
  "waiting-parts",
  "completed",
  "paid",
  "cancelled",
  "closed",
]);

function asOrderStatus(value: string): OrderStatus | null {
  return ORDER_STATUSES.has(value as OrderStatus) ? (value as OrderStatus) : null;
}

function itemToFormData(item: InventoryItem) {
  return {
    name: item.name,
    sku: item.sku,
    description: item.description,
    category: item.category,
    quantity: item.quantity,
    minQuantity: item.minQuantity,
    unit: item.unit,
    purchasePrice: item.purchasePrice,
    sellingPrice: item.sellingPrice,
    supplier: item.supplier,
    location: item.location,
    isActive: item.isActive,
    warrantyType: item.warrantyType ?? "none",
    warrantyMonths: item.warrantyMonths ?? null,
    warrantyKm: item.warrantyKm ?? null,
  };
}

function stopBubble(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function LegacyDeleteBody({
  item,
  onClose,
  onDeleted,
}: {
  item: InventoryItem;
  onClose: () => void;
  onDeleted?: (itemId: string) => void;
}) {
  const { t } = useTranslation();
  const { mutate: deleteItem, isPending: isDeleting } = useDeleteInventoryItem();

  return (
    <>
      <p className="text-sm text-muted-foreground">
        <Trans
          i18nKey="inventory.dialogs.deleteConfirm"
          values={{ name: item.name }}
          components={{ strong: <strong className="text-foreground" /> }}
        />
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={isDeleting}
          onClick={() => {
            deleteItem(item.id, {
              onSuccess: () => {
                onDeleted?.(item.id);
                onClose();
              },
            });
          }}
        >
          {isDeleting ? t("common.deleting") : t("common.delete")}
        </Button>
      </div>
    </>
  );
}

function MarkInactiveButton({
  item,
  onClose,
  disabled,
}: {
  item: InventoryItem;
  onClose: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { mutate: updateItem, isPending } = useUpdateInventoryItem();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled || isPending || !item.isActive}
      onClick={() => {
        updateItem(
          { id: item.id, ...itemToFormData(item), isActive: false },
          {
            onSuccess: () => onClose(),
          },
        );
      }}
    >
      {isPending ? t("common.saving") : t("inventory.purge.markInactive")}
    </Button>
  );
}

function BlockingOrdersBody({
  item,
  preview,
  onClose,
  onOpenOrder,
}: {
  item: InventoryItem;
  preview: InventoryItemDeletePreview;
  onClose: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const { workspaceId } = useActiveWorkspaceId();
  const locale = languageFromPath(location.pathname);
  const ordersPath = workspaceId ? ordersListPath(locale, workspaceId) : "#";

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{t("inventory.purge.usedInOrdersTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("inventory.purge.usedInOrdersHint")}</p>
      </div>
      <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
        {preview.blockingOrders.map((order) => {
          const status = asOrderStatus(order.status);
          return (
            <li key={order.orderId} className="flex items-center justify-between gap-2 px-1 py-1.5">
              <Link
                to={ordersPath}
                className="text-sm font-medium text-primary tabular-nums underline-offset-2 hover:underline"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenOrder(order.orderId);
                }}
              >
                {order.number}
              </Link>
              {status ? <OrderStatusBadge status={status} /> : <span className="text-xs text-muted-foreground">{order.status}</span>}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <MarkInactiveButton item={item} onClose={onClose} />
        <Button type="button" variant="destructive" disabled>
          {t("inventory.purge.deletePermanently")}
        </Button>
      </div>
    </div>
  );
}

function OwnerOnlyBody({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("inventory.purge.ownerOnly")}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <MarkInactiveButton item={item} onClose={onClose} />
      </div>
    </div>
  );
}

function CanDeleteBody({
  item,
  preview,
  onClose,
  onDeleted,
  onPurgeError,
}: {
  item: InventoryItem;
  preview: InventoryItemDeletePreview;
  onClose: () => void;
  onDeleted?: (itemId: string) => void;
  onPurgeError: () => void;
}) {
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState(false);
  const { mutate: purgeItem, isPending: isPurging } = usePurgeInventoryItem();
  const { mutate: deleteItem, isPending: isLegacyDeleting } = useDeleteInventoryItem();
  const busy = isPurging || isLegacyDeleting;

  useEffect(() => {
    setConfirmed(false);
  }, [item.id, preview.itemId]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <Trans
          i18nKey="inventory.dialogs.deleteConfirm"
          values={{ name: item.name }}
          components={{ strong: <strong className="text-foreground" /> }}
        />
      </p>
      <p className="text-sm text-muted-foreground">
        {t("inventory.purge.willRemove", {
          quantity: preview.stockQuantity,
          movements: preview.movementsCount,
          batches: preview.batchesCount,
          serials: preview.serialsCount,
          draftLines: preview.draftDocumentLinesCount,
        })}
      </p>
      {preview.postedDocumentLinesCount > 0 ? (
        <p className="text-sm text-muted-foreground">{t("inventory.purge.postedNote", { count: preview.postedDocumentLinesCount })}</p>
      ) : null}
      {preview.cancelledOrdersCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("inventory.purge.cancelledOrdersNote", { count: preview.cancelledOrdersCount })}
        </p>
      ) : null}
      <div className="flex items-start gap-2">
        <input
          id="inventory-purge-confirm"
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 rounded border border-input"
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <Label htmlFor="inventory-purge-confirm" className="text-sm font-normal leading-snug">
          {t("inventory.purge.confirmIrreversible")}
        </Label>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={!confirmed || busy}
          onClick={() => {
            purgeItem(item.id, {
              onSuccess: () => {
                onDeleted?.(item.id);
                onClose();
              },
              onError: (error) => {
                if (error instanceof MissingRpcError) {
                  deleteItem(item.id, {
                    onSuccess: () => {
                      onDeleted?.(item.id);
                      onClose();
                    },
                  });
                  return;
                }
                onPurgeError();
              },
            });
          }}
        >
          {busy ? t("common.deleting") : t("inventory.purge.deletePermanently")}
        </Button>
      </div>
    </div>
  );
}

export function DeleteInventoryItemDialog({ item, onClose, onDeleted }: DeleteInventoryItemDialogProps) {
  const { t } = useTranslation();
  const { workflow } = useIndustryWorkflow();
  const inventoryCopy = industryInventoryCopy(workflow);
  const { workspaceId } = useActiveWorkspaceId();
  const orderDetails = useOrderDetails();
  const open = Boolean(item);
  const previewQuery = useInventoryItemDeletePreview(item?.id, open);
  const missingRpc = previewQuery.error instanceof MissingRpcError;
  const preview = previewQuery.data;

  const title = missingRpc ? inventoryCopy.deleteDialogTitle : t("inventory.purge.title");
  const description = missingRpc ? t("inventory.dialogs.deleteDescription") : item?.name ?? "";

  async function openBlockingOrder(orderId: string) {
    if (!workspaceId) return;
    const order = await getOrder(orderId, workspaceId);
    if (order) orderDetails.openOrder(order);
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <DialogContent className="max-w-md" onClick={stopBubble} onPointerDown={stopBubble}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {!item ? null : missingRpc ? (
            <LegacyDeleteBody item={item} onClose={onClose} onDeleted={onDeleted} />
          ) : previewQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Spinner className="h-5 w-5" />
              <span>{t("common.loading")}</span>
            </div>
          ) : previewQuery.isError ? (
            <EmptyState
              title={t("inventory.loadError.title")}
              description={previewQuery.error.message || t("inventory.errors.deleteFailed")}
              action={{ label: t("common.retry"), onClick: () => void previewQuery.refetch() }}
            />
          ) : preview && preview.blockingOrders.length > 0 ? (
            <BlockingOrdersBody item={item} preview={preview} onClose={onClose} onOpenOrder={openBlockingOrder} />
          ) : preview && !preview.isOwner ? (
            <OwnerOnlyBody item={item} onClose={onClose} />
          ) : preview && preview.canDelete ? (
            <CanDeleteBody
              item={item}
              preview={preview}
              onClose={onClose}
              onDeleted={onDeleted}
              onPurgeError={() => {
                void previewQuery.refetch();
              }}
            />
          ) : (
            <EmptyState
              title={t("inventory.loadError.title")}
              description={t("inventory.errors.deleteFailed")}
              action={{ label: t("common.retry"), onClick: () => void previewQuery.refetch() }}
            />
          )}
        </DialogContent>
      </Dialog>

      {orderDetails.panelProps.selectedOrder ? <OrderDetailPanel {...orderDetails.panelProps} /> : null}
    </>
  );
}
