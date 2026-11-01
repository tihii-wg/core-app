import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import type { InventoryItem } from "../../lib/types";
import type { WarehouseRecord } from "../../services/apiWarehouses";
import type { WarehouseStockRecord } from "../../services/apiWarehouseStock";
import { useCreateGoodsReceipt, useCreateStockTransfer, useCreateWriteOff } from "./useWarehouseOps";
import {
  parseDecimalInput,
  stockByItemForWarehouse,
  sumLineAmounts,
  validateOpLines,
  type OpLineInput,
  type OpLineIssue,
  type WarehouseOpKind,
} from "./warehouseOps";

type DraftLine = { key: number; itemId: string; quantity: string; unitCost: string };

type WarehouseOpDialogProps = {
  kind: WarehouseOpKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouses: WarehouseRecord[];
  items: InventoryItem[];
  stock: WarehouseStockRecord[];
  formatMoney: (value: number) => string;
};

export function WarehouseOpDialog({ kind, open, onOpenChange, ...rest }: WarehouseOpDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(`inventory.ops.${kind}.dialogTitle`)}</DialogTitle>
          <DialogDescription>{t(`inventory.ops.${kind}.dialogDescription`)}</DialogDescription>
        </DialogHeader>
        {open ? <OpForm kind={kind} onDone={() => onOpenChange(false)} {...rest} /> : null}
      </DialogContent>
    </Dialog>
  );
}

let lineKey = 0;
const newLine = (): DraftLine => ({ key: ++lineKey, itemId: "", quantity: "", unitCost: "" });

function issueMessage(t: TFunction, issue: OpLineIssue, lineLabel: (i: number) => string) {
  switch (issue.code) {
    case "noLines":
      return t("inventory.ops.validation.noLines");
    case "insufficientStock":
      return t("inventory.ops.validation.insufficientStock", {
        line: lineLabel(issue.index),
        available: issue.available,
        requested: issue.requested,
      });
    default:
      return t(`inventory.ops.validation.${issue.code}`, { line: lineLabel(issue.index) });
  }
}

function OpForm({
  kind,
  onDone,
  warehouses,
  items,
  stock,
  formatMoney,
}: Omit<WarehouseOpDialogProps, "open" | "onOpenChange"> & { onDone: () => void }) {
  const { t } = useTranslation();
  const createReceipt = useCreateGoodsReceipt();
  const createTransfer = useCreateStockTransfer();
  const createWriteOff = useCreateWriteOff();
  const isPending = createReceipt.isPending || createTransfer.isPending || createWriteOff.isPending;

  const activeWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.isActive), [warehouses]);
  const activeItems = useMemo(() => items.filter((item) => item.isActive), [items]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const [warehouseId, setWarehouseId] = useState(activeWarehouses.find((w) => w.isDefault)?.id ?? activeWarehouses[0]?.id ?? "");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()]);
  const [error, setError] = useState<string | null>(null);

  const sourceStock = useMemo(
    () => (kind === "receipt" ? undefined : stockByItemForWarehouse(stock, warehouseId)),
    [kind, stock, warehouseId],
  );

  const parsedLines = lines.map((line) => ({
    inventoryItemId: line.itemId,
    itemName: itemById.get(line.itemId)?.name ?? "",
    quantity: parseDecimalInput(line.quantity) ?? Number.NaN,
    unitCost: line.unitCost.trim() === "" ? 0 : (parseDecimalInput(line.unitCost) ?? Number.NaN),
  })) satisfies OpLineInput[];

  const total = sumLineAmounts(parsedLines.filter((line) => Number.isFinite(line.quantity) && Number.isFinite(line.unitCost)));
  const targets = activeWarehouses.filter((warehouse) => warehouse.id !== warehouseId);
  const warehouseLabel = kind === "transfer" ? t("inventory.ops.fields.fromWarehouse") : t("inventory.ops.fields.warehouse");

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function pickItem(key: number, itemId: string) {
    const item = itemById.get(itemId);
    updateLine(key, {
      itemId,
      // Receipts and write-offs default to the item's purchase price; the user can still change it.
      unitCost: item?.purchasePrice != null ? String(item.purchasePrice) : "",
    });
  }

  function handleWarehouseChange(id: string) {
    setWarehouseId(id);
    if (id === toWarehouseId) setToWarehouseId("");
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isPending) return;

    if (!warehouseId) return setError(t("inventory.ops.validation.warehouseRequired"));
    if (kind === "transfer") {
      if (!toWarehouseId) return setError(t("inventory.ops.validation.toWarehouseRequired"));
      if (toWarehouseId === warehouseId) return setError(t("inventory.ops.validation.sameWarehouse"));
    }
    const issue = validateOpLines(kind, parsedLines, sourceStock);
    if (issue) {
      return setError(issueMessage(t, issue, (index) => String(index + 1)));
    }

    setError(null);
    const options = { onSuccess: onDone };
    if (kind === "receipt") createReceipt.mutate({ warehouseId, comment, lines: parsedLines }, options);
    else if (kind === "transfer") createTransfer.mutate({ fromWarehouseId: warehouseId, toWarehouseId, comment, lines: parsedLines }, options);
    else createWriteOff.mutate({ warehouseId, reason, comment, lines: parsedLines }, options);
  }

  if (activeWarehouses.length === 0) {
    return (
      <div className="space-y-4">
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{t("inventory.ops.noWarehouses")}</p>
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onDone}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 py-1">
        <div className={kind === "transfer" ? "grid gap-3 sm:grid-cols-2" : "space-y-1.5"}>
          <div className="space-y-1.5">
            <Label>{warehouseLabel}</Label>
            <Select value={warehouseId} onValueChange={handleWarehouseChange} disabled={isPending}>
              <SelectTrigger aria-label={warehouseLabel}>
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
          {kind === "transfer" ? (
            <div className="space-y-1.5">
              <Label>{t("inventory.ops.fields.toWarehouse")}</Label>
              <Select value={toWarehouseId} onValueChange={setToWarehouseId} disabled={isPending || targets.length === 0}>
                <SelectTrigger aria-label={t("inventory.ops.fields.toWarehouse")}>
                  <SelectValue placeholder={t("inventory.ops.fields.warehousePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {targets.length === 0 ? <p className="text-xs text-muted-foreground">{t("inventory.ops.noTargetWarehouse")}</p> : null}
            </div>
          ) : null}
        </div>

        {kind === "writeOff" ? (
          <div className="space-y-1.5">
            <Label htmlFor="op-reason">{t("inventory.ops.fields.reason")}</Label>
            <Input id="op-reason" maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} disabled={isPending} />
          </div>
        ) : null}

        <div className="space-y-2">
          <Label>{t("inventory.ops.fields.lines")}</Label>
          {activeItems.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{t("inventory.ops.noItems")}</p>
          ) : null}
          <ul className="space-y-2">
            {lines.map((line, index) => {
              const item = itemById.get(line.itemId);
              const available = sourceStock?.get(line.itemId) ?? 0;
              return (
                <li key={line.key} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[minmax(0,1fr)_6rem_7rem_auto] sm:items-start">
                  <div className="min-w-0 space-y-1">
                    <Select value={line.itemId} onValueChange={(value) => pickItem(line.key, value)} disabled={isPending}>
                      <SelectTrigger aria-label={t("inventory.ops.fields.itemAria", { line: index + 1 })}>
                        <SelectValue placeholder={t("inventory.ops.fields.itemPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {activeItems.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                            {option.sku ? ` · ${option.sku}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {item && kind !== "receipt" ? (
                      <p className="text-xs text-muted-foreground">
                        {t("inventory.ops.fields.available", { count: available, unit: item.unit })}
                      </p>
                    ) : null}
                  </div>
                  <Input
                    inputMode="decimal"
                    placeholder={t("inventory.ops.fields.quantity")}
                    aria-label={t("inventory.ops.fields.quantityAria", { line: index + 1 })}
                    value={line.quantity}
                    onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                    disabled={isPending}
                  />
                  <Input
                    inputMode="decimal"
                    placeholder={t("inventory.ops.fields.unitCost")}
                    aria-label={t("inventory.ops.fields.unitCostAria", { line: index + 1 })}
                    value={line.unitCost}
                    onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
                    disabled={isPending}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("inventory.ops.fields.removeLine", { line: index + 1 })}
                    disabled={isPending || lines.length === 1}
                    onClick={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, newLine()])} disabled={isPending}>
              <Plus />
              {t("inventory.ops.fields.addLine")}
            </Button>
            <p className="text-sm text-muted-foreground">
              {t("inventory.ops.fields.total")}: <span className="font-medium tabular-nums text-foreground">{formatMoney(total)}</span>
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="op-comment">{t("inventory.ops.fields.comment")}</Label>
          <Input id="op-comment" maxLength={500} value={comment} onChange={(event) => setComment(event.target.value)} disabled={isPending} />
        </div>

        <p className="text-xs text-muted-foreground">{t(`inventory.ops.${kind}.draftHint`)}</p>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={isPending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isPending || activeItems.length === 0}>
          {isPending ? <Spinner className="size-4" /> : null}
          {t("inventory.ops.saveDraft")}
        </Button>
      </div>
    </form>
  );
}
