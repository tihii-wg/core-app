import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import type { SupplierReturnRecord } from "../../services/apiWarehouseOps";
import { useFinanceAccounts } from "../finance/useFinanceAccounts";
import { useMyPermissions } from "../roles/useMyPermissions";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { parseDecimalInput } from "./warehouseOps";
import { useRecordSupplierReturnRefund } from "./useWarehouseOps";

const FINANCE_INCOME_PERMISSION = "finance.transactions.income";

function defaultOccurredAtLocal() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

type SupplierReturnRefundDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnDoc: SupplierReturnRecord | null;
};

/** Records money received back from the supplier for a posted return that has no refund yet. */
export function SupplierReturnRefundDialog({ open, onOpenChange, returnDoc }: SupplierReturnRefundDialogProps) {
  const { t } = useTranslation();
  const { currency, formatMoney } = useWorkspaceMoney();
  const { can } = useMyPermissions();
  const canRecordIncome = can(FINANCE_INCOME_PERMISSION);
  const { data: financeAccounts = [] } = useFinanceAccounts();
  const record = useRecordSupplierReturnRefund();

  const accountOptions = useMemo(
    () => financeAccounts.filter((account) => account.isActive && account.currencyCode === currency),
    [financeAccounts, currency],
  );
  const defaultAccountId = accountOptions[0]?.id ?? "";

  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredAt, setOccurredAt] = useState(defaultOccurredAtLocal);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !returnDoc) return;
    setAccountId(defaultAccountId);
    setAmount(String(returnDoc.total));
    setOccurredAt(defaultOccurredAtLocal());
    setComment("");
    setError(null);
  }, [open, returnDoc, defaultAccountId]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!returnDoc || record.isPending) return;

    if (!accountId) {
      setError(t("inventory.supplierReturn.refund.errors.accountRequired"));
      return;
    }
    const parsed = parseDecimalInput(amount);
    if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) {
      setError(t("inventory.supplierReturn.refund.errors.amountPositive"));
      return;
    }
    if (parsed - returnDoc.total > 0.005) {
      setError(t("inventory.supplierReturn.refund.errors.amountExceeds", { total: formatMoney(returnDoc.total) }));
      return;
    }

    setError(null);
    record.mutate(
      {
        returnId: returnDoc.id,
        input: {
          accountId,
          amount: parsed,
          occurredAt: occurredAt ? new Date(occurredAt).toISOString() : null,
          comment: comment.trim() || null,
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("inventory.supplierReturn.refund.recordTitle")}</DialogTitle>
          <DialogDescription>
            {returnDoc
              ? `${returnDoc.number?.trim() || returnDoc.id.slice(0, 8)} · ${formatMoney(returnDoc.total)}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {!returnDoc ? null : !canRecordIncome ? (
          <p className="text-sm text-muted-foreground">{t("inventory.supplierReturn.refund.errors.forbidden")}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("inventory.supplierReturn.refund.account")}</Label>
              <Select value={accountId} onValueChange={setAccountId} disabled={record.isPending || accountOptions.length === 0}>
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

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sr-refund-amount">{t("inventory.supplierReturn.refund.amount")}</Label>
                <Input
                  id="sr-refund-amount"
                  inputMode="decimal"
                  value={amount}
                  disabled={record.isPending}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sr-refund-date">{t("inventory.supplierReturn.refund.date")}</Label>
                <Input
                  id="sr-refund-date"
                  type="datetime-local"
                  value={occurredAt}
                  disabled={record.isPending}
                  onChange={(event) => setOccurredAt(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sr-refund-comment">{t("inventory.supplierReturn.refund.comment")}</Label>
              <Input
                id="sr-refund-comment"
                maxLength={500}
                value={comment}
                disabled={record.isPending}
                onChange={(event) => setComment(event.target.value)}
              />
            </div>

            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={record.isPending} onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={record.isPending || accountOptions.length === 0}>
                {record.isPending ? <Spinner className="size-4" /> : null}
                {t("inventory.supplierReturn.refund.recordAction")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SupplierReturnRefundBadge({
  amount,
  accountName,
}: {
  amount: number;
  accountName: string;
}) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  return (
    <span className="inline-flex max-w-full items-center rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-inset ring-success/20 [overflow-wrap:anywhere]">
      {t("inventory.supplierReturn.refund.badge", { amount: formatMoney(amount), account: accountName })}
    </span>
  );
}
