import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Spinner } from "../../ui/Spinner";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useCreateEstimate } from "./useEstimateMutations";

type EstimateFormDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

export function EstimateFormDialog({ open, onOpenChange }: EstimateFormDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("stage9.estimates.form.title")}</DialogTitle>
          <DialogDescription>{t("stage9.estimates.form.description")}</DialogDescription>
        </DialogHeader>
        {open ? <EstimateForm onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EstimateForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { currency } = useWorkspaceMoney();
  const { mutate: create, isPending } = useCreateEstimate();
  const [number, setNumber] = useState("");
  const [total, setTotal] = useState("");
  const value = total.trim() === "" ? 0 : Number(total.replace(",", "."));
  const totalValid = Number.isFinite(value) && value >= 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isPending || !totalValid) return;
    create({ number, total: value }, { onSuccess: onDone });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="estimate-number">{t("stage9.estimates.form.number")}</Label>
          <Input
            id="estimate-number"
            maxLength={64}
            value={number}
            disabled={isPending}
            onChange={(event) => setNumber(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t("stage9.estimates.form.numberHint")}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="estimate-total">{t("stage9.estimates.form.total", { currency })}</Label>
          <Input
            id="estimate-total"
            inputMode="decimal"
            placeholder="0.00"
            value={total}
            disabled={isPending}
            aria-invalid={!totalValid}
            onChange={(event) => setTotal(event.target.value)}
          />
          {!totalValid ? <p className="text-xs text-destructive">{t("stage9.estimates.errors.totalInvalid")}</p> : null}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={isPending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isPending || !totalValid}>
          {isPending ? <Spinner className="size-4" /> : null}
          {t("stage9.estimates.form.submit")}
        </Button>
      </div>
    </form>
  );
}
