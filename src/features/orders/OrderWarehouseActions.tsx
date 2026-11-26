import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import type { Order, OrderMaterial, WarehouseMaterialLineInput } from "../../lib/types";
import { formatQuantity, parseQuantity } from "../../lib/quantity";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Textarea } from "../../ui/Textarea";
import { isCatalogOrderMaterial } from "../inventory/orderMaterialLine";
import { remainingToIssue, remainingToReturn } from "../inventory/warehouseMaterialStatus";
import { useInventoryItemsByIds } from "../inventory/useGetInventoryItems";
import { issueOrderMaterialsFromWarehouse, returnOrderMaterialsToWarehouse } from "../../services/apiWarehouse";
import { useGetWarehouses } from "../warehouses/useGetWarehouses";
import { useWarehouseStockForItems } from "../warehouses/useGetWarehouseStock";
import { defaultIssueWarehouseId, issuableWarehouses, warehouseStockOf } from "./issueWarehouse";
import { issueRequestsExceedingStock } from "./catalogMaterialStockLimit";
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
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  /** Lines taking part: all of them for an issue; for a return the user ticks what actually comes back. */
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [warehouseId, setWarehouseId] = useState("");
  const submitLock = useRef(false);
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const queryClient = useQueryClient();
  const { data: warehouseRows } = useGetWarehouses();

  const warehouses = useMemo(() => issuableWarehouses(warehouseRows), [warehouseRows]);

  const materials = order.materials ?? [];
  // One-time / customer-supplied lines never touch warehouse stock.
  const stockMaterials = useMemo(() => materials.filter((line) => isCatalogOrderMaterial(line)), [materials]);
  const issueable = useMemo(() => stockMaterials.filter((line) => remainingToIssue(line) > 0), [stockMaterials]);
  const returnable = useMemo(() => stockMaterials.filter((line) => remainingToReturn(line) > 0), [stockMaterials]);
  // Warehouse stock of this order's parts, only while the issue dialog is open (a return does not need it).
  const { data: warehouseStock, isSuccess: warehouseStockLoaded } = useWarehouseStockForItems(
    stockMaterials.map((line) => line.inventoryItemId ?? null),
    mode === "issue",
  );
  // Stock of this order's parts only (was the whole catalog), and only while the dialog is open.
  const { items: inventoryItems } = useInventoryItemsByIds(
    stockMaterials.map((line) => line.inventoryItemId?.trim() ?? ""),
    { enabled: mode !== null },
  );

  function openDialog(next: Mode) {
    const lines = next === "issue" ? issueable : returnable;
    const initial: Record<string, string> = {};
    const picked: Record<string, boolean> = {};
    for (const line of lines) {
      const itemId = line.inventoryItemId?.trim();
      if (!itemId) continue;
      const max = next === "issue" ? remainingToIssue(line) : remainingToReturn(line);
      initial[itemId] = String(max);
      // A single returnable line is obviously the one to return; with several, nothing is ticked up front.
      picked[itemId] = next === "issue" || lines.length === 1;
    }
    setQuantities(initial);
    setSelected(picked);
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
      if (!selected[itemId]) continue;
      const raw = quantities[itemId] ?? "";
      if (String(raw).trim() === "") continue;
      const parsed = parseQuantity(raw);
      if (typeof parsed !== "number") {
        if (parsed === "maxDecimals") toast.error(t("orders.validation.quantityMaxDecimals"));
        else if (parsed === "min") toast.error(t("orders.validation.quantityMin"));
        else toast.error(t("orders.validation.quantityRequired"));
        return;
      }
      const qty = parsed;
      const max = mode === "issue" ? remainingToIssue(line) : remainingToReturn(line);
      if (qty > max) {
        toast.error(mode === "issue" ? t("orders.errors.issueExceedsRemaining") : t("orders.errors.returnExceedsOutstanding"));
        return;
      }
      lines.push({ inventoryItemId: itemId, quantity: qty });
    }
    if (lines.length === 0) {
      toast.error(
        source.some((line) => selected[line.inventoryItemId?.trim() ?? ""])
          ? t("orders.warehouse.noQuantitySelected")
          : t("orders.warehouse.noItemSelected"),
      );
      return;
    }

    // Warehouse-first: issue/return always require an explicitly selected active warehouse.
    if (!warehouseId) {
      toast.error(t("orders.warehouse.warehouseRequired"));
      return;
    }

    if (mode === "issue" && warehouseStockLoaded) {
      const over = issueRequestsExceedingStock(lines, warehouseStock, warehouseId);
      if (over.length > 0) {
        const first = over[0]!;
        const warehouseName = warehouses.find((warehouse) => warehouse.id === warehouseId)?.name ?? warehouseId;
        toast.error(
          t("orders.form.onlyNAvailableOnWarehouse", {
            available: formatQuantity(first.available, i18n.language),
            warehouse: warehouseName,
          }),
        );
        return;
      }
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
      await queryClient.invalidateQueries({ queryKey: ["orders-warranty-indicators", workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ["warranty-records", workspaceId] });
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
            {(() => {
              const lines = mode === "issue" ? issueable : returnable;
              if (lines.length < 2) return null;
              const ids = lines.map((line) => line.inventoryItemId?.trim() ?? "").filter(Boolean);
              const allPicked = ids.every((id) => selected[id]);
              return (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {t("orders.warehouse.selectedCount", { count: ids.filter((id) => selected[id]).length, total: ids.length })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setSelected(Object.fromEntries(ids.map((id) => [id, !allPicked])))}
                  >
                    {allPicked ? t("orders.warehouse.selectNone") : t("orders.warehouse.selectAll")}
                  </Button>
                </div>
              );
            })()}
            {(mode === "issue" ? issueable : returnable).map((line) => {
              const itemId = line.inventoryItemId?.trim();
              if (!itemId) return null;
              return (
                <WarehouseLineEditor
                  key={itemId}
                  line={{ ...line, inventoryItemId: itemId }}
                  mode={mode!}
                  selected={Boolean(selected[itemId])}
                  onSelectedChange={(next) => setSelected((prev) => ({ ...prev, [itemId]: next }))}
                  value={quantities[itemId] ?? ""}
                  stock={inventoryItems.find((item) => item.id === itemId)?.quantity}
                  warehouseStock={mode === "issue" && warehouseId && warehouseStockLoaded ? warehouseStockOf(warehouseStock, warehouseId, itemId) : undefined}
                  warehouseName={warehouses.find((warehouse) => warehouse.id === warehouseId)?.name}
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
  selected,
  onSelectedChange,
  value,
  stock,
  warehouseStock,
  warehouseName,
  onChange,
  disabled,
}: {
  line: OrderMaterial;
  mode: Mode;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  value: string;
  stock?: number;
  warehouseStock?: number;
  warehouseName?: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const remaining = mode === "issue" ? remainingToIssue(line) : remainingToReturn(line);
  const max =
    mode === "issue" && warehouseStock != null ? Math.min(remaining, Math.max(0, warehouseStock)) : remaining;
  const locale = i18n.language;
  const parsed = parseQuantity(value);
  const typedQty = typeof parsed === "number" ? parsed : null;
  const overStock = selected && mode === "issue" && warehouseStock != null && typedQty != null && typedQty > max + 1e-9;

  return (
    <div className={`space-y-2 rounded-md border p-3 ${selected ? "border-primary/50" : "border-border opacity-70"}`}>
      <label className="flex min-w-0 cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
          checked={selected}
          disabled={disabled}
          onChange={(event) => onSelectedChange(event.target.checked)}
        />
      <div className="min-w-0">
        <p className="font-medium [overflow-wrap:anywhere]">{line.itemName}</p>
        <p className="text-[13px] text-muted-foreground tabular-nums">
          {t("orders.warehouse.requested")}: {formatQuantity(line.quantity, locale)}
          {" · "}
          {t("orders.warehouse.issued")}: {formatQuantity(line.quantityIssued ?? 0, locale)}
          {" · "}
          {t("orders.warehouse.returned")}: {formatQuantity(line.quantityReturned ?? 0, locale)}
        </p>
        {mode === "issue" && stock != null ? (
          <p className="text-[13px] text-muted-foreground tabular-nums">
            {t("orders.form.availableStock")}: {formatQuantity(stock, locale)}
          </p>
        ) : null}
        {mode === "issue" && warehouseStock != null ? (
          <p className="text-[13px] text-muted-foreground tabular-nums">
            {t("orders.form.availableOnWarehouse", {
              warehouse: warehouseName ?? "",
              count: formatQuantity(warehouseStock, locale),
            })}
          </p>
        ) : null}
      </div>
      </label>
      <div className="flex flex-wrap items-center gap-2 pl-6.5">
        <Label htmlFor={`warehouse-qty-${line.inventoryItemId}`} className="shrink-0 text-xs text-muted-foreground">
          {mode === "issue" ? t("orders.warehouse.issueQty") : t("orders.warehouse.returnQty")}
        </Label>
        <Input
          id={`warehouse-qty-${line.inventoryItemId}`}
          type="text"
          inputMode="decimal"
          disabled={disabled || !selected}
          className={`h-8 min-w-[4.5rem] w-24 max-w-[40vw] tabular-nums ${overStock ? "border-destructive" : ""}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="text-xs text-muted-foreground tabular-nums">/ {formatQuantity(max, locale)}</span>
      </div>
      {overStock ? (
        <p className="text-xs text-destructive" role="alert">
          {t("orders.form.onlyNAvailableOnWarehouse", {
            available: formatQuantity(max, locale),
            warehouse: warehouseName ?? "",
          })}
        </p>
      ) : null}
    </div>
  );
}
