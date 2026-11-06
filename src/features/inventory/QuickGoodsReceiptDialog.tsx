import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import type { InventoryItem } from "../../lib/types";
import { useGetWarehouses } from "../warehouses/useGetWarehouses";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { parseDecimalInput, validateOpLines } from "./warehouseOps";
import { useCreateAndPostGoodsReceipt } from "./useWarehouseOps";

type QuickGoodsReceiptDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Catalog item to receive. Dialog is a no-op when null. */
  item: InventoryItem | null;
  /** Called after a successful create+post receipt (stock already updated server-side). */
  onReceived?: (itemId: string) => void;
  /** Optional default quantity (e.g. order line requested qty). */
  defaultQuantity?: number;
};

/**
 * Single-item goods receipt used from orders and inventory detail.
 * Reuses createAndPostGoodsReceipt → same draft document + crm_post_goods_receipt as Warehouse ops.
 */
export function QuickGoodsReceiptDialog({
  open,
  onOpenChange,
  item,
  onReceived,
  defaultQuantity = 1,
}: QuickGoodsReceiptDialogProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const { data: warehouses = [], isLoading: warehousesLoading } = useGetWarehouses();
  const receive = useCreateAndPostGoodsReceipt();

  const activeWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.isActive), [warehouses]);
  const defaultWarehouseId = activeWarehouses.find((w) => w.isDefault)?.id ?? activeWarehouses[0]?.id ?? "";

  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId);
  const [quantity, setQuantity] = useState(String(defaultQuantity > 0 ? defaultQuantity : 1));
  const [unitCost, setUnitCost] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const warehouseIdsKey = activeWarehouses.map((warehouse) => warehouse.id).join(",");

  useEffect(() => {
    if (!open || !item) return;
    setWarehouseId(activeWarehouses.find((w) => w.isDefault)?.id ?? activeWarehouses[0]?.id ?? "");
    setQuantity(String(defaultQuantity > 0 ? defaultQuantity : 1));
    setUnitCost(item.purchasePrice != null ? String(item.purchasePrice) : "");
    setComment("");
    setError(null);
    // Reset when the dialog opens for an item / qty / warehouse list identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeWarehouses read from latest render via warehouseIdsKey
  }, [open, item, defaultQuantity, warehouseIdsKey]);

  const qtyParsed = parseDecimalInput(quantity);
  const costParsed = unitCost.trim() === "" ? 0 : parseDecimalInput(unitCost);
  const lineTotal =
    qtyParsed != null && costParsed != null && Number.isFinite(qtyParsed) && Number.isFinite(costParsed)
      ? qtyParsed * costParsed
      : null;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!item || receive.isPending) return;

    if (!warehouseId) {
      setError(t("inventory.ops.validation.warehouseRequired"));
      return;
    }
    if (qtyParsed == null || !Number.isFinite(qtyParsed) || qtyParsed <= 0) {
      setError(t("inventory.ops.validation.quantityPositive", { line: "1" }));
      return;
    }
    if (costParsed == null || !Number.isFinite(costParsed) || costParsed < 0) {
      setError(t("inventory.ops.validation.costNegative", { line: "1" }));
      return;
    }

    const lines = [
      {
        inventoryItemId: item.id,
        itemName: item.name,
        quantity: qtyParsed,
        unitCost: costParsed,
      },
    ];
    const issue = validateOpLines("receipt", lines);
    if (issue) {
      setError(t(`inventory.ops.validation.${issue.code}`, { line: "1" }));
      return;
    }

    setError(null);
    receive.mutate(
      {
        warehouseId,
        comment: comment.trim() || undefined,
        supplierName: item.supplier?.trim() || null,
        lines,
      },
      {
        onSuccess: () => {
          onReceived?.(item.id);
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("inventory.ops.quickReceipt.title")}</DialogTitle>
          <DialogDescription>{t("inventory.ops.quickReceipt.description")}</DialogDescription>
        </DialogHeader>

        {!item ? null : warehousesLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-5 w-5" />
          </div>
        ) : activeWarehouses.length === 0 ? (
          <div className="space-y-4 py-2">
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {t("inventory.ops.noWarehouses")}
            </p>
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-1">
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <p className="text-sm font-medium [overflow-wrap:anywhere]">{item.name}</p>
              {item.sku?.trim() ? <p className="text-xs text-muted-foreground">{item.sku}</p> : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {t("inventory.ops.quickReceipt.currentStock", { count: item.quantity, unit: item.unit })}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="quick-receipt-warehouse">{t("inventory.ops.fields.warehouse")}</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId} disabled={receive.isPending}>
                <SelectTrigger id="quick-receipt-warehouse" aria-label={t("inventory.ops.fields.warehouse")}>
                  <SelectValue placeholder={t("inventory.ops.fields.warehousePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {activeWarehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="quick-receipt-qty">{t("inventory.ops.fields.quantity")}</Label>
                <Input
                  id="quick-receipt-qty"
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={quantity}
                  disabled={receive.isPending}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quick-receipt-cost">{t("inventory.ops.fields.unitCost")}</Label>
                <Input
                  id="quick-receipt-cost"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={unitCost}
                  disabled={receive.isPending}
                  onChange={(event) => setUnitCost(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="quick-receipt-comment">{t("inventory.ops.fields.comment")}</Label>
              <Input
                id="quick-receipt-comment"
                value={comment}
                disabled={receive.isPending}
                onChange={(event) => setComment(event.target.value)}
                placeholder={t("inventory.ops.quickReceipt.commentPlaceholder")}
              />
            </div>

            {lineTotal != null ? (
              <p className="text-sm text-muted-foreground">
                {t("inventory.ops.fields.total")}: <span className="font-medium tabular-nums text-foreground">{formatMoney(lineTotal)}</span>
              </p>
            ) : null}

            <p className="text-xs text-muted-foreground">{t("inventory.ops.quickReceipt.postHint")}</p>

            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={receive.isPending} onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={receive.isPending}>
                {receive.isPending ? t("inventory.ops.quickReceipt.receiving") : t("inventory.ops.quickReceipt.receive")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
