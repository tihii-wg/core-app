import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { EmptyState } from "../../ui/EmptyState";
import type { InventoryItem } from "../../lib/types";
import { languageFromPath } from "../../i18n/languages";
import { industryInventoryCopy } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWarehouses } from "../warehouses/useGetWarehouses";
import InventoryItemForm from "./InventoryItemForm";
import { DEFAULT_INVENTORY_MIN_QUANTITY } from "./inventoryDefaults";
import { useCreateInventoryItem } from "./useCreateInventoryItem";
import { useInventoryMarkupEditor } from "./useInventoryMarkupEditor";

const emptyInventoryForm = {
  name: "",
  sku: "",
  description: "",
  category: "",
  quantity: 0,
  // min_quantity 0 disables low_stock (only out_of_stock at qty<=0). Default 10 for new parts.
  minQuantity: DEFAULT_INVENTORY_MIN_QUANTITY,
  purchasePrice: null,
  sellingPrice: null,
  supplier: "",
  location: "",
  isActive: true,
};

type AddInventoryItemDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefills the name field (e.g. from order material search). */
  initialName?: string;
  /** Called with the created item after a successful save (form stays open on error). */
  onCreated?: (item: InventoryItem) => void;
};

export function AddInventoryItemDialog({ open, onOpenChange, initialName = "", onCreated }: AddInventoryItemDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceId } = useActiveWorkspaceId();
  const { workflow } = useIndustryWorkflow();
  const inventoryCopy = industryInventoryCopy(workflow);
  const { markupPercent, markupLoading, commitMarkup } = useInventoryMarkupEditor();
  const { mutate: createItem, isPending: isCreating } = useCreateInventoryItem();
  const { data: warehouses = [], isLoading: warehousesLoading, isSuccess: warehousesLoaded } = useGetWarehouses();
  const hasActiveWarehouse = warehouses.some((warehouse) => warehouse.isActive);
  // Create always starts at zero stock; receipt is a separate warehouse document.
  const formKey = open ? `create-${initialName}` : "closed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{inventoryCopy.addDialogTitle}</DialogTitle>
          <DialogDescription className="sr-only">{inventoryCopy.addDialogDescription}</DialogDescription>
        </DialogHeader>
        {warehousesLoading || markupLoading ? (
          <p className="text-sm text-muted-foreground">{t("inventory.dialogs.loadingItem")}</p>
        ) : warehousesLoaded && !hasActiveWarehouse ? (
          <EmptyState
            title={t("inventory.warehouseRequired.title")}
            description={t("inventory.warehouseRequired.description")}
            action={{
              label: t("inventory.warehouseRequired.openWarehouses"),
              onClick: () => {
                onOpenChange(false);
                const locale = languageFromPath(location.pathname);
                navigate(`/${locale}/${workspaceId}/warehouses`);
              },
            }}
          />
        ) : (
          <InventoryItemForm
            key={formKey}
            defaultValues={{
              ...emptyInventoryForm,
              name: initialName,
              unit: t("inventory.form.defaultUnit"),
              quantity: 0,
            }}
            markupPercent={markupPercent}
            submitLabel={inventoryCopy.addItem}
            isSubmitting={isCreating}
            lockQuantity
            isCreate
            onCancel={() => onOpenChange(false)}
            onMarkupCommit={commitMarkup}
            onSubmit={(data) => {
              if (!hasActiveWarehouse) return;
              createItem({ ...data, quantity: 0 }, {
                onSuccess: (item) => {
                  onCreated?.(item);
                  onOpenChange(false);
                },
              });
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
