import { useEffect, useMemo, useState } from "react";
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
import { useGetInventorySuppliers } from "./useGetInventorySuppliers";
import { AddInventoryItemDialog } from "./AddInventoryItemDialog";
import {
  useCreateGoodsReceipt,
  useCreateStockTransfer,
  useCreateSupplierReturn,
  useCreateWriteOff,
} from "./useWarehouseOps";
import {
  assignCreatedItemToOpLines,
  parseDecimalInput,
  stockByItemForWarehouse,
  sumLineAmounts,
  validateOpLines,
  type OpDraftLine,
  type OpLineInput,
  type OpLineIssue,
  type WarehouseOpKind,
} from "./warehouseOps";

type DraftLine = OpDraftLine;

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
  // Keep the receipt dialog mounted while the nested create-material dialog is open.
  const [addMaterialOpen, setAddMaterialOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && addMaterialOpen) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(`inventory.ops.${kind}.dialogTitle`)}</DialogTitle>
          <DialogDescription>{t(`inventory.ops.${kind}.dialogDescription`)}</DialogDescription>
        </DialogHeader>
        {open ? (
          <OpForm
            kind={kind}
            onDone={() => onOpenChange(false)}
            addMaterialOpen={addMaterialOpen}
            onAddMaterialOpenChange={setAddMaterialOpen}
            {...rest}
          />
        ) : null}
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
  addMaterialOpen,
  onAddMaterialOpenChange,
}: Omit<WarehouseOpDialogProps, "open" | "onOpenChange"> & {
  onDone: () => void;
  addMaterialOpen: boolean;
  onAddMaterialOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const createReceipt = useCreateGoodsReceipt();
  const createTransfer = useCreateStockTransfer();
  const createWriteOff = useCreateWriteOff();
  const createSupplierReturn = useCreateSupplierReturn();
  const isPending =
    createReceipt.isPending || createTransfer.isPending || createWriteOff.isPending || createSupplierReturn.isPending;

  const activeWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.isActive), [warehouses]);
  // Items created during this draft stay selectable until the parent inventory query catches up.
  const [createdItems, setCreatedItems] = useState<InventoryItem[]>([]);

  const catalogItems = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const item of createdItems) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    return Array.from(byId.values());
  }, [items, createdItems]);

  const activeItems = useMemo(() => catalogItems.filter((item) => item.isActive), [catalogItems]);
  const itemById = useMemo(() => new Map(catalogItems.map((item) => [item.id, item])), [catalogItems]);
  // Parent list with zero active items (not a filtered search) — empty catalog for this workspace.
  const catalogEmpty = items.filter((item) => item.isActive).length === 0 && createdItems.length === 0;

  const { suppliers } = useGetInventorySuppliers();
  const [warehouseId, setWarehouseId] = useState(activeWarehouses.find((w) => w.isDefault)?.id ?? activeWarehouses[0]?.id ?? "");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [reason, setReason] = useState(kind === "writeOff" ? "other" : "");
  const [comment, setComment] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()]);
  const [error, setError] = useState<string | null>(null);

  const commonLineSupplier = useMemo(() => {
    if (kind !== "receipt") return "";
    const names = new Set(
      lines
        .map((line) => itemById.get(line.itemId)?.supplier?.trim() ?? "")
        .filter(Boolean),
    );
    return names.size === 1 ? [...names][0]! : "";
  }, [kind, lines, itemById]);

  useEffect(() => {
    if (kind !== "receipt" || !commonLineSupplier) return;
    setSupplierName((current) => (current.trim() ? current : commonLineSupplier));
  }, [kind, commonLineSupplier]);

  const sourceStock = useMemo(
    () => (kind === "receipt" ? undefined : stockByItemForWarehouse(stock, warehouseId)),
    [kind, stock, warehouseId],
  );
  const needsSupplierField = kind === "receipt" || kind === "supplierReturn";

  const parsedLines = lines.map((line) => ({
    inventoryItemId: line.itemId,
    itemName: itemById.get(line.itemId)?.name ?? "",
    quantity: parseDecimalInput(line.quantity) ?? Number.NaN,
    unitCost: line.unitCost.trim() === "" ? 0 : (parseDecimalInput(line.unitCost) ?? Number.NaN),
  })) satisfies OpLineInput[];

  const total = sumLineAmounts(parsedLines.filter((line) => Number.isFinite(line.quantity) && Number.isFinite(line.unitCost)));
  const targets = activeWarehouses.filter((warehouse) => warehouse.id !== warehouseId);
  const warehouseLabel = kind === "transfer" ? t("inventory.ops.fields.fromWarehouse") : t("inventory.ops.fields.warehouse");
  const canAddMaterial = kind === "receipt";

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

  function handleMaterialCreated(item: InventoryItem) {
    setCreatedItems((current) => (current.some((existing) => existing.id === item.id) ? current : [...current, item]));
    const unitCost = item.purchasePrice != null ? String(item.purchasePrice) : "";
    setLines((current) => assignCreatedItemToOpLines(current, item.id, unitCost, newLine));
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

    if (kind === "supplierReturn" && reason.trim().length < 3) {
      return setError(t("inventory.supplierReturn.reasonRequired"));
    }

    setError(null);
    const options = { onSuccess: onDone };
    if (kind === "receipt") {
      createReceipt.mutate(
        {
          warehouseId,
          comment,
          supplierName: supplierName.trim() || null,
          lines: parsedLines,
        },
        options,
      );
    } else if (kind === "transfer") {
      createTransfer.mutate({ fromWarehouseId: warehouseId, toWarehouseId, comment, lines: parsedLines }, options);
    } else if (kind === "writeOff") {
      createWriteOff.mutate({ warehouseId, reason, comment, lines: parsedLines }, options);
    } else {
      createSupplierReturn.mutate(
        {
          warehouseId,
          supplierName: supplierName.trim() || null,
          reason: reason.trim(),
          comment,
          lines: parsedLines,
        },
        options,
      );
    }
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
    <>
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
              <Select value={reason || "other"} onValueChange={setReason} disabled={isPending}>
                <SelectTrigger id="op-reason" aria-label={t("inventory.ops.fields.reason")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="damaged">{t("inventory.ops.reasons.damaged")}</SelectItem>
                  <SelectItem value="lost">{t("inventory.ops.reasons.lost")}</SelectItem>
                  <SelectItem value="internal_use">{t("inventory.ops.reasons.internalUse")}</SelectItem>
                  <SelectItem value="expired">{t("inventory.ops.reasons.expired")}</SelectItem>
                  <SelectItem value="other">{t("inventory.ops.reasons.other")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {kind === "supplierReturn" ? (
            <div className="space-y-1.5">
              <Label htmlFor="op-return-reason">{t("inventory.supplierReturn.reason")}</Label>
              <textarea
                id="op-return-reason"
                className="min-h-[4.5rem] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                value={reason}
                maxLength={500}
                disabled={isPending}
                onChange={(event) => setReason(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("inventory.supplierReturn.financeHint")}</p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>{t("inventory.ops.fields.lines")}</Label>
            {catalogEmpty ? (
              <div className="space-y-3 rounded-md border border-border bg-muted/40 px-3 py-4 text-center">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{t("inventory.ops.emptyCatalog.title")}</p>
                  <p className="text-sm text-muted-foreground">{t("inventory.ops.emptyCatalog.description")}</p>
                </div>
                {canAddMaterial ? (
                  <Button type="button" onClick={() => onAddMaterialOpenChange(true)} disabled={isPending}>
                    <Plus />
                    {t("inventory.ops.addMaterial")}
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("inventory.ops.noItems")}</p>
                )}
              </div>
            ) : (
              <>
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, newLine()])} disabled={isPending}>
                      <Plus />
                      {t("inventory.ops.fields.addLine")}
                    </Button>
                    {canAddMaterial ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => onAddMaterialOpenChange(true)} disabled={isPending}>
                        <Plus />
                        {t("inventory.ops.fields.addMaterial")}
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("inventory.ops.fields.total")}: <span className="font-medium tabular-nums text-foreground">{formatMoney(total)}</span>
                  </p>
                </div>
              </>
            )}
          </div>

          {needsSupplierField ? (
            <div className="space-y-1.5">
              <Label htmlFor="op-supplier">{t("inventory.ops.fields.supplier")}</Label>
              <Input
                id="op-supplier"
                list="op-supplier-suggestions"
                maxLength={200}
                value={supplierName}
                onChange={(event) => setSupplierName(event.target.value)}
                disabled={isPending}
                placeholder={t("inventory.form.supplierPlaceholder")}
                autoComplete="off"
              />
              <datalist id="op-supplier-suggestions">
                {suppliers.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
          ) : null}

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

      {canAddMaterial ? (
        <AddInventoryItemDialog open={addMaterialOpen} onOpenChange={onAddMaterialOpenChange} onCreated={handleMaterialCreated} />
      ) : null}
    </>
  );
}
