import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FinanceAccount } from "../../services/apiFinanceAccounts";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import { useCreateFinanceTransfer } from "./useFinanceAccounts";

type FinanceTransferDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: FinanceAccount[];
};

export function FinanceTransferDialog({ open, onOpenChange, accounts }: FinanceTransferDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("finance.accounts.transfer.title")}</DialogTitle>
          <DialogDescription>{t("finance.accounts.transfer.description")}</DialogDescription>
        </DialogHeader>
        {open ? <TransferForm accounts={accounts} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TransferForm({ accounts, onDone }: { accounts: FinanceAccount[]; onDone: () => void }) {
  const { t } = useTranslation();
  const { mutate: transfer, isPending } = useCreateFinanceTransfer();
  const [fromId, setFromId] = useState(accounts[0]?.id ?? "");
  const [toId, setToId] = useState(accounts[1]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const from = accounts.find((account) => account.id === fromId);
  const targets = accounts.filter((account) => account.id !== fromId && account.currencyCode === from?.currencyCode);

  function handleFromChange(id: string) {
    setFromId(id);
    const source = accounts.find((account) => account.id === id);
    const stillValid = accounts.some((a) => a.id === toId && a.id !== id && a.currencyCode === source?.currencyCode);
    if (!stillValid) setToId(accounts.find((a) => a.id !== id && a.currencyCode === source?.currencyCode)?.id ?? "");
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isPending) return;
    const value = Number(amount);
    if (!fromId || !toId || fromId === toId) return setError(t("finance.accounts.transfer.errors.sameAccount"));
    if (!Number.isFinite(value) || value <= 0) return setError(t("finance.accounts.transfer.errors.amountPositive"));
    setError(null);
    transfer({ fromAccountId: fromId, toAccountId: toId, amount: value, comment }, { onSuccess: onDone });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label>{t("finance.accounts.transfer.from")}</Label>
          <Select value={fromId} onValueChange={handleFromChange} disabled={isPending}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name} ({account.currencyCode})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("finance.accounts.transfer.to")}</Label>
          <Select value={toId} onValueChange={setToId} disabled={isPending || targets.length === 0}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {targets.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name} ({account.currencyCode})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {targets.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("finance.accounts.transfer.noTargets")}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="transfer-amount">
            {t("finance.accounts.transfer.amount", { currency: from?.currencyCode ?? "" })}
          </Label>
          <Input
            id="transfer-amount"
            type="number"
            min={0.01}
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="transfer-comment">{t("finance.accounts.transfer.comment")}</Label>
          <Input
            id="transfer-comment"
            maxLength={500}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={isPending}
          />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={isPending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isPending || !toId}>
          {isPending ? <Spinner className="size-4" /> : null}
          {t("finance.accounts.transfer.submit")}
        </Button>
      </div>
    </form>
  );
}
