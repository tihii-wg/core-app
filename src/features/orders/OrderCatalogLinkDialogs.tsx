import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { DeleteInventoryItemDialog } from "../inventory/DeleteInventoryItemDialog";
import { EditInventoryItemDialog } from "../inventory/EditInventoryItemDialog";
import InventoryDetailPanel from "../inventory/InventoryDetailPanel";
import { useGetInventoryItem } from "../inventory/useGetInventoryItem";
import EditServiceForm from "../services/UpdateServiceForm";
import useGetServices from "../services/useGetServices";
import type { InventoryItem } from "../../lib/types";

type Props = {
  serviceId: string | null;
  inventoryItemId: string | null;
  onCloseService: () => void;
  onCloseInventory: () => void;
};

/**
 * Catalog windows opened from an order card: a service line opens the same edit form as
 * Services → edit; a catalog material opens the inventory item card (stock per warehouse).
 */
export function OrderCatalogLinkDialogs({ serviceId, inventoryItemId, onCloseService, onCloseInventory }: Props) {
  const { t } = useTranslation();
  const { services } = useGetServices();
  const service = serviceId ? services.find((item) => item.id === serviceId) ?? null : null;
  const inventoryDetail = useGetInventoryItem(inventoryItemId);
  const [editInventoryId, setEditInventoryId] = useState<string | null>(null);
  const [inventoryToDelete, setInventoryToDelete] = useState<InventoryItem | null>(null);

  return (
    <>
      <Dialog open={Boolean(serviceId)} onOpenChange={(open) => !open && onCloseService()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("services.dialogs.editTitle")}</DialogTitle>
            <DialogDescription className="sr-only">{t("services.dialogs.editTitle")}</DialogDescription>
          </DialogHeader>
          {service ? (
            <EditServiceForm
              key={service.id}
              service={service}
              setEditModalOpen={(open) => {
                if (!open) onCloseService();
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("orders.catalogLink.serviceMissing")}</p>
          )}
        </DialogContent>
      </Dialog>

      <InventoryDetailPanel
        item={inventoryDetail.item}
        open={Boolean(inventoryItemId)}
        isLoading={inventoryDetail.isLoading}
        isError={inventoryDetail.isError}
        onOpenChange={(open) => {
          if (!open) onCloseInventory();
        }}
        onRetry={() => inventoryDetail.refetch()}
        onEdit={() => {
          setEditInventoryId(inventoryItemId);
          onCloseInventory();
        }}
        onDelete={() => {
          if (!inventoryDetail.item) return;
          setInventoryToDelete(inventoryDetail.item);
          onCloseInventory();
        }}
      />
      {editInventoryId ? <EditInventoryItemDialog itemId={editInventoryId} onClose={() => setEditInventoryId(null)} /> : null}
      <DeleteInventoryItemDialog item={inventoryToDelete} onClose={() => setInventoryToDelete(null)} />
    </>
  );
}
