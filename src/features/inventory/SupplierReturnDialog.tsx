import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import type { GoodsReceiptRecord } from "../../services/apiWarehouseOps";
import { useFinanceAccounts } from "../finance/useFinanceAccounts";
import { useMyPermissions } from "../roles/useMyPermissions";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { lineAmount, parseDecimalInput, roundQty, sumLineAmounts } from "./warehouseOps";
import { useCreateAndPostSupplierReturn, useReturnedQuantitiesForReceipt } from "./useWarehouseOps";

const FINANCE_INCOME_PERMISSION = "finance.transactions.income";

type SupplierReturnDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: GoodsReceiptRecord | null;
  warehouseName: string;
};

type LineDraft = {
  inventoryItemId: string;
  itemName: string;
  itemSku: string | null;
  receivedQty: number;
  unitCost: number;
  quantity: string;
};

/**
 * Return goods from a posted receipt back to the supplier. Quantities default to 0;
 * only lines with qty > 0 are submitted. Server sets final unit costs from batches.
 */
export function SupplierReturnDialog({ open, onOpenChange, receipt, warehouseName }: SupplierReturnDialogProps) {
  const { t } = useTranslation();
  const { currency, formatMoney } = useWorkspaceMoney();
  const { can } = useMyPermissions();
  const canRecordIncome = can(FINANCE_INCOME_PERMISSION);
  const { data: financeAccounts = [] } = useFinanceAccounts();
  const submit = useCreateAndPostSupplierReturn();
  const returnedQuery = useReturnedQuantitiesForReceipt(receipt?.id, open && Boolean(receipt?.id));

  const accountOptions = useMemo(
    () => financeAccounts.filter((account) => account.isActive && account.currencyCode === currency),
    [financeAccounts, currency],
  );
  const defaultRefundAccountId = accountOptions[0]?.id ?? "";

  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [moneyBack, setMoneyBack] = useState(false);
  const [refundAccountId, setRefundAccountId] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundComment, setRefundComment] = useState("");

  useEffect(() => {
    if (!open || !receipt) return;
    setReason("");
    setError(null);
    setMoneyBack(false);
    setRefundAccountId(defaultRefundAccountId);
    setRefundAmount("");
    setRefundComment("");
    setLines(
      receipt.lines
        .filter((line) => line.inventoryItemId)
        .map((line) => ({
          inventoryItemId: line.inventoryItemId!,
          itemName: line.itemName,
          itemSku: line.itemSku,
          receivedQty: line.quantity,
          unitCost: line.unitCost,
          quantity: "0",
        })),
    );
  }, [open, receipt, defaultRefundAccountId]);

  const returnedByItem = returnedQuery.data ?? new Map<string, number>();

  const rows = useMemo(
    () =>
      lines.map((line) => {
        const alreadyReturned = returnedByItem.get(line.inventoryItemId) ?? 0;
        const maxReturnable = roundQty(Math.max(0, line.receivedQty - alreadyReturned));
        return { ...line, alreadyReturned, maxReturnable };
      }),
    [lines, returnedByItem],
  );

  const estimateTotal = useMemo(() => {
    const priced = rows
      .map((row) => {
        const qty = parseDecimalInput(row.quantity) ?? 0;
        if (!Number.isFinite(qty) || qty <= 0) return null;
        return { quantity: qty, unitCost: row.unitCost };
      })
      .filter((row): row is { quantity: number; unitCost: number } => row != null);
    return sumLineAmounts(priced);
  }, [rows]);

  useEffect(() => {
    if (!moneyBack) return;
    setRefundAmount((current) => (current.trim() ? current : estimateTotal > 0 ? String(estimateTotal) : current));
  }, [moneyBack, estimateTotal]);

  function updateQty(inventoryItemId: string, value: string) {
    setLines((current) => current.map((line) => (line.inventoryItemId === inventoryItemId ? { ...line, quantity: value } : line)));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!receipt || submit.isPending) return;

    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      setError(t("inventory.supplierReturn.reasonRequired"));
      return;
    }

    const submitLines: { inventoryItemId: string; itemName: string; quantity: number; unitCost: number }[] = [];
    for (const row of rows) {
      const qty = parseDecimalInput(row.quantity);
      if (qty == null || !Number.isFinite(qty) || qty <= 0) continue;
      if (Math.abs(qty - roundQty(qty)) >= 1e-9) {
        setError(t("inventory.ops.validation.quantityPrecision", { line: row.itemName }));
        return;
      }
      if (qty > row.maxReturnable) {
        setError(
          t("inventory.supplierReturn.exceedsMax", {
            name: row.itemName,
            max: row.maxReturnable,
          }),
        );
        return;
      }
      submitLines.push({
        inventoryItemId: row.inventoryItemId,
        itemName: row.itemName,
        quantity: qty,
        unitCost: row.unitCost,
      });
    }

    if (submitLines.length === 0) {
      setError(t("inventory.supplierReturn.noLines"));
      return;
    }

    let refund: { accountId: string; amount: number; comment?: string | null } | null = null;
    if (moneyBack && canRecordIncome) {
      if (!refundAccountId) {
        setError(t("inventory.supplierReturn.refund.errors.accountRequired"));
        return;
      }
      const parsedRefund = parseDecimalInput(refundAmount);
      if (parsedRefund == null || !Number.isFinite(parsedRefund) || parsedRefund <= 0) {
        setError(t("inventory.supplierReturn.refund.errors.amountPositive"));
        return;
      }
      if (parsedRefund - estimateTotal > 0.005) {
        setError(
          t("inventory.supplierReturn.refund.errors.amountExceeds", { total: formatMoney(estimateTotal) }),
        );
        return;
      }
      refund = {
        accountId: refundAccountId,
        amount: parsedRefund,
        comment: refundComment.trim() || null,
      };
    }

    setError(null);
    submit.mutate(
      {
        warehouseId: receipt.warehouseId ?? "",
        goodsReceiptId: receipt.id,
        supplierName: receipt.supplierName,
        reason: trimmedReason,
        lines: submitLines,
        refund,
      },
      {
        onSuccess: () => onOpenChange(false),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("inventory.supplierReturn.title")}</DialogTitle>
          <DialogDescription>{t("inventory.supplierReturn.financeHint")}</DialogDescription>
        </DialogHeader>

        {!receipt ? null : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t("inventory.ops.fields.warehouse")}</dt>
                <dd className="font-medium">{warehouseName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("inventory.ops.fields.supplier")}</dt>
                <dd className="font-medium [overflow-wrap:anywhere]">{receipt.supplierName || "—"}</dd>
              </div>
            </dl>

            {returnedQuery.isLoading ? (
              <div className="flex justify-center py-6">
                <Spinner className="h-5 w-5" />
              </div>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {rows.map((row) => (
                  <li key={row.inventoryItemId} className="space-y-2 px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium [overflow-wrap:anywhere]">{row.itemName}</p>
                      {row.itemSku ? <p className="font-mono text-xs text-muted-foreground">{row.itemSku}</p> : null}
                      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                        {t("inventory.supplierReturn.received")}: {row.receivedQty}
                        {" · "}
                        {t("inventory.supplierReturn.alreadyReturned")}: {row.alreadyReturned}
                        {" · "}
                        {t("inventory.supplierReturn.maxReturnable")}: {row.maxReturnable}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`return-qty-${row.inventoryItemId}`} className="shrink-0 text-xs text-muted-foreground">
                        {t("inventory.supplierReturn.quantity")}
                      </Label>
                      <Input
                        id={`return-qty-${row.inventoryItemId}`}
                        inputMode="decimal"
                        className="h-8 max-w-[8rem]"
                        value={row.quantity}
                        disabled={submit.isPending || row.maxReturnable <= 0}
                        onChange={(event) => updateQty(row.inventoryItemId, event.target.value)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="supplier-return-reason">{t("inventory.supplierReturn.reason")}</Label>
              <textarea
                id="supplier-return-reason"
                className="min-h-[4.5rem] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                value={reason}
                maxLength={500}
                disabled={submit.isPending}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>

            <p className="text-sm text-muted-foreground">
              {t("inventory.supplierReturn.estimateTotal")}:{" "}
              <span className="font-medium tabular-nums text-foreground">{formatMoney(estimateTotal)}</span>
            </p>

            {canRecordIncome ? (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <p className="text-sm font-medium">{t("inventory.supplierReturn.refund.section")}</p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input"
                    checked={moneyBack}
                    disabled={submit.isPending}
                    onChange={(event) => setMoneyBack(event.target.checked)}
                  />
                  {t("inventory.supplierReturn.refund.refunded")}
                </label>
                {moneyBack ? (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>{t("inventory.supplierReturn.refund.account")}</Label>
                      <Select
                        value={refundAccountId}
                        onValueChange={setRefundAccountId}
                        disabled={submit.isPending || accountOptions.length === 0}
                      >
                        <SelectTrigger aria-label={t("inventory.supplierReturn.refund.account")}>
                          <SelectValue placeholder={t("inventory.supplierReturn.refund.accountPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {accountOptions.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="supplier-return-refund-amount">{t("inventory.supplierReturn.refund.amount")}</Label>
                      <Input
                        id="supplier-return-refund-amount"
                        inputMode="decimal"
                        value={refundAmount}
                        disabled={submit.isPending}
                        onChange={(event) => setRefundAmount(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="supplier-return-refund-comment">{t("inventory.supplierReturn.refund.comment")}</Label>
                      <Input
                        id="supplier-return-refund-comment"
                        maxLength={500}
                        value={refundComment}
                        disabled={submit.isPending}
                        onChange={(event) => setRefundComment(event.target.value)}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={submit.isPending} onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={submit.isPending || returnedQuery.isLoading}>
                {submit.isPending ? <Spinner className="size-4" /> : null}
                {t("inventory.supplierReturn.submit")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Pure helpers exported for tests. */
export function maxReturnableQty(received: number, alreadyReturned: number) {
  return roundQty(Math.max(0, received - alreadyReturned));
}

export function estimateReturnTotal(lines: { quantity: number; unitCost: number }[]) {
  return sumLineAmounts(lines);
}

export function lineReturnAmount(quantity: number, unitCost: number) {
  return lineAmount(quantity, unitCost);
}
