import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import type { Order, OrderMaterial, WarehouseMaterialLineInput } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Textarea } from "../../ui/Textarea";
import { parseOrderMaterialQuantity } from "../inventory/orderMaterialLine";
import { remainingToIssue, remainingToReturn } from "../inventory/warehouseMaterialStatus";
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
import { issueOrderMaterials, returnOrderMaterials } from "../../services/apiWarehouse";
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
  const submitLock = useRef(false);
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const queryClient = useQueryClient();
  const { items: inventoryItems } = useGetInventoryItems("", "all", { field: "name", ascending: true });

  const materials = order.materials ?? [];
  const issueable = useMemo(() => materials.filter((line) => remainingToIssue(line) > 0), [materials]);
  const returnable = useMemo(() => materials.filter((line) => remainingToReturn(line) > 0), [materials]);

  function openDialog(next: Mode) {
    const lines = next === "issue" ? issueable : returnable;
    const initial: Record<string, string> = {};
    for (const line of lines) {
      const max = next === "issue" ? remainingToIssue(line) : remainingToReturn(line);
      initial[line.inventoryItemId] = String(max);
    }
    setQuantities(initial);
    setReason("");
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
      const raw = quantities[line.inventoryItemId] ?? "";
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
      lines.push({ inventoryItemId: line.inventoryItemId, quantity: qty });
    }
    if (lines.length === 0) {
      toast.error(t("orders.warehouse.noQuantitySelected"));
      return;
    }

    submitLock.current = true;
    setBusy(true);
    const toastId = mode === "issue" ? "issue-materials" : "return-materials";
    toast.loading(mode === "issue" ? t("orders.toast.issuing") : t("orders.toast.returning"), { id: toastId });

    try {
      guardWrite();
      const idempotencyKey = crypto.randomUUID();
      if (mode === "issue") {
        await issueOrderMaterials(order.id, lines, idempotencyKey);
      } else {
        await returnOrderMaterials(order.id, lines, reason, idempotencyKey);
      }
      const refreshed = await getOrder(order.id, workspaceId);
      onOrderUpdated(refreshed);
      await queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ["inventory-movements", workspaceId] });
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

  if (!canManage || materials.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={issueable.length === 0} onClick={() => openDialog("issue")}>
          {t("orders.warehouse.issueAction")}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={returnable.length === 0} onClick={() => openDialog("return")}>
          {t("orders.warehouse.returnAction")}
        </Button>
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
            {(mode === "issue" ? issueable : returnable).map((line) => (
              <WarehouseLineEditor
                key={line.inventoryItemId}
                line={line}
                mode={mode!}
                value={quantities[line.inventoryItemId] ?? ""}
                stock={inventoryItems.find((item) => item.id === line.inventoryItemId)?.quantity}
                onChange={(value) => setQuantities((prev) => ({ ...prev, [line.inventoryItemId]: value }))}
                disabled={busy}
              />
            ))}

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
  onChange,
  disabled,
}: {
  line: OrderMaterial;
  mode: Mode;
  value: string;
  stock?: number;
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
