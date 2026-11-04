import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import type { Order, OrderMaterial, WarehouseMaterialLineInput } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Textarea } from "../../ui/Textarea";
import { isCatalogOrderMaterial, parseOrderMaterialQuantity } from "../inventory/orderMaterialLine";
import { remainingToIssue, remainingToReturn } from "../inventory/warehouseMaterialStatus";
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
import { issueOrderMaterialsFromWarehouse, returnOrderMaterialsToWarehouse } from "../../services/apiWarehouse";
import { useGetWarehouses } from "../warehouses/useGetWarehouses";
import { useGetWarehouseStock } from "../warehouses/useGetWarehouseStock";
import { defaultIssueWarehouseId, issuableWarehouses, linesExceedingWarehouseStock, warehouseStockOf } from "./issueWarehouse";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { getOrder } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { useQueryClient } from "@tanstack/react-query";

type Mode = "issue" | "return";

type OrderWarehouseActionsProps = {
  order: Order;
  canManage: boolean;
  onOrderUpdated: (order: Order) => void;
};

export default function OrderWarehouseActions({ order, canManage, onOrderUpdated }: OrderWarehouseActionsProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [warehouseId, setWarehouseId] = useState("");
  const submitLock = useRef(false);
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const queryClient = useQueryClient();
  const { items: inventoryItems } = useGetInventoryItems("", "all", { field: "name", ascending: true });

  const { data: warehouseRows } = useGetWarehouses();
  const { data: warehouseStock, isSuccess: warehouseStockLoaded } = useGetWarehouseStock();
  const warehouses = useMemo(() => issuableWarehouses(warehouseRows), [warehouseRows]);

  const materials = order.materials ?? [];
  // One-time / customer-supplied lines never touch warehouse stock.
  const stockMaterials = useMemo(() => materials.filter((line) => isCatalogOrderMaterial(line)), [materials]);
  const issueable = useMemo(() => stockMaterials.filter((line) => remainingToIssue(line) > 0), [stockMaterials]);
  const returnable = useMemo(() => stockMaterials.filter((line) => remainingToReturn(line) > 0), [stockMaterials]);

  function openDialog(next: Mode) {
    const lines = next === "issue" ? issueable : returnable;
    const initial: Record<string, string> = {};
    for (const line of lines) {
      const itemId = line.inventoryItemId?.trim();
      if (!itemId) continue;
      const max = next === "issue" ? remainingToIssue(line) : remainingToReturn(line);
      initial[itemId] = String(max);
    }
    setQuantities(initial);
    setReason("");
    setWarehouseId(defaultIssueWarehouseId(warehouseRows));
    setMode(next);
  }

  function closeDialog() {
    if (busy) return;
    setMode(null);
  }

  async function handleConfirm() {
    if (!mode || busy || submitLock.current) return;
    const source = mode === "issue" ? issueable : returnable;
    const lines: WarehouseMaterialLineInput[] = [];
    for (const line of source) {
      const itemId = line.inventoryItemId?.trim();
      if (!itemId) continue;
      const raw = quantities[itemId] ?? "";
      if (String(raw).trim() === "") continue;
      const qty = parseOrderMaterialQuantity(raw);
      if (qty == null) {
        const asNumber = Number(String(raw).trim());
        if (Number.isFinite(asNumber) && asNumber > 0 && !Number.isInteger(asNumber)) {
          toast.error(t("orders.validation.quantityInteger"));
        } else if (Number.isFinite(asNumber) && asNumber <= 0) {
          toast.error(t("orders.validation.quantityMin"));
        } else {
          toast.error(t("orders.validation.quantityRequired"));
        }
        return;
      }
      const max = mode === "issue" ? remainingToIssue(line) : remainingToReturn(line);
      if (qty > max) {
        toast.error(mode === "issue" ? t("orders.errors.issueExceedsRemaining") : t("orders.errors.returnExceedsOutstanding"));
        return;
      }
      lines.push({ inventoryItemId: itemId, quantity: qty });
    }
    if (lines.length === 0) {
      toast.error(t("orders.warehouse.noQuantitySelected"));
      return;
    }

    // Warehouse-first: issue/return always require an explicitly selected active warehouse.
    if (!warehouseId) {
      toast.error(t("orders.warehouse.warehouseRequired"));
      return;
    }

    if (mode === "issue" && warehouseStockLoaded && linesExceedingWarehouseStock(lines, warehouseStock, warehouseId).length > 0) {
      toast.error(t("orders.errors.insufficientWarehouseStock"));
      return;
    }

    submitLock.current = true;
    setBusy(true);
    const toastId = mode === "issue" ? "issue-materials" : "return-materials";
    toast.loading(mode === "issue" ? t("orders.toast.issuing") : t("orders.toast.returning"), { id: toastId });

    try {
      guardWrite();
      const idempotencyKey = crypto.randomUUID();
      // Never call legacy global issue/return — warehouse stock would desync.
      if (mode === "issue") {
        await issueOrderMaterialsFromWarehouse(order.id, lines, warehouseId, idempotencyKey);
      } else {
        await returnOrderMaterialsToWarehouse(order.id, lines, warehouseId, reason, idempotencyKey);
      }
      const refreshed = await getOrder(order.id, workspaceId);
      onOrderUpdated(refreshed);
      await queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ["inventory-movements", workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ["warehouse-stock", workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId] });
      toast.success(mode === "issue" ? t("orders.toast.issued") : t("orders.toast.returned"), { id: toastId });
      setMode(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("common.somethingWentWrong");
      toast.error(message, { id: toastId });
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  }

  // Freeform (one-time / customer) lines never participate in warehouse issue/return.
  if (!canManage || stockMaterials.length === 0) return null;

  const warehouseOpsDisabled = warehouses.length === 0;

  return (
    <>
      <div className="space-y-2">
        {warehouseOpsDisabled ? (
          <p className="text-xs text-muted-foreground">{t("orders.warehouse.noActiveWarehouse")}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={warehouseOpsDisabled || issueable.length === 0}
            onClick={() => openDialog("issue")}
          >
            {t("orders.warehouse.issueAction")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={warehouseOpsDisabled || returnable.length === 0}
            onClick={() => openDialog("return")}
          >
            {t("orders.warehouse.returnAction")}
          </Button>
        </div>
      </div>

      <Dialog open={mode != null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{mode === "issue" ? t("orders.warehouse.issueTitle") : t("orders.warehouse.returnTitle")}</DialogTitle>
            <DialogDescription>
              {mode === "issue" ? t("orders.warehouse.issueDescription") : t("orders.warehouse.returnDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="order-warehouse">
                {mode === "issue" ? t("orders.warehouse.warehouseLabel") : t("orders.warehouse.returnWarehouseLabel")}
              </Label>
              <Select value={warehouseId} onValueChange={setWarehouseId} disabled={busy || warehouseOpsDisabled}>
                <SelectTrigger
                  id="order-warehouse"
                  aria-label={mode === "issue" ? t("orders.warehouse.warehouseLabel") : t("orders.warehouse.returnWarehouseLabel")}
                >
                  <SelectValue placeholder={t("orders.warehouse.warehousePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {mode === "issue" ? t("orders.warehouse.warehouseHint") : t("orders.warehouse.returnWarehouseHint")}
              </p>
            </div>
            {(mode === "issue" ? issueable : returnable).map((line) => {
              const itemId = line.inventoryItemId?.trim();
              if (!itemId) return null;
              return (
                <WarehouseLineEditor
                  key={itemId}
                  line={{ ...line, inventoryItemId: itemId }}
                  mode={mode!}
                  value={quantities[itemId] ?? ""}
                  stock={inventoryItems.find((item) => item.id === itemId)?.quantity}
                  warehouseStock={mode === "issue" && warehouseId && warehouseStockLoaded ? warehouseStockOf(warehouseStock, warehouseId, itemId) : undefined}
                  onChange={(value) => setQuantities((prev) => ({ ...prev, [itemId]: value }))}
                  disabled={busy}
                />
              );
            })}

            {mode === "return" ? (
              <div className="space-y-1.5">
                <Label htmlFor="return-reason">{t("orders.warehouse.returnReason")}</Label>
                <Textarea
                  id="return-reason"
                  value={reason}
                  disabled={busy}
                  maxLength={500}
                  placeholder={t("orders.warehouse.returnReasonPlaceholder")}
                  onChange={(event) => setReason(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("orders.warehouse.damagedReturnHint")}</p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={closeDialog}>
              {t("common.cancel")}
            </Button>
            <Button type="button" disabled={busy} onClick={handleConfirm}>
              {mode === "issue" ? t("orders.warehouse.confirmIssue") : t("orders.warehouse.confirmReturn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function WarehouseLineEditor({
  line,
  mode,
  value,
  stock,
  warehouseStock,
  onChange,
  disabled,
}: {
  line: OrderMaterial;
  mode: Mode;
  value: string;
  stock?: number;
  warehouseStock?: number;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const max = mode === "issue" ? remainingToIssue(line) : remainingToReturn(line);

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="min-w-0">
        <p className="font-medium [overflow-wrap:anywhere]">{line.itemName}</p>
        <p className="text-[13px] text-muted-foreground tabular-nums">
          {t("orders.warehouse.requested")}: {line.quantity}
          {" · "}
          {t("orders.warehouse.issued")}: {line.quantityIssued ?? 0}
          {" · "}
          {t("orders.warehouse.returned")}: {line.quantityReturned ?? 0}
        </p>
        {mode === "issue" && stock != null ? (
          <p className="text-[13px] text-muted-foreground tabular-nums">
            {t("orders.form.availableStock")}: {stock}
          </p>
        ) : null}
        {mode === "issue" && warehouseStock != null ? (
          <p className="text-[13px] text-muted-foreground tabular-nums">{t("orders.warehouse.warehouseStock", { count: warehouseStock })}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor={`warehouse-qty-${line.inventoryItemId}`} className="shrink-0 text-xs text-muted-foreground">
          {mode === "issue" ? t("orders.warehouse.issueQty") : t("orders.warehouse.returnQty")}
        </Label>
        <Input
          id={`warehouse-qty-${line.inventoryItemId}`}
          type="number"
          min={1}
          max={max}
          step={1}
          inputMode="numeric"
          disabled={disabled}
          className="h-8 w-24 tabular-nums"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="text-xs text-muted-foreground tabular-nums">/ {max}</span>
      </div>
    </div>
  );
}
