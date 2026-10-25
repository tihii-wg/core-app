import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import { Textarea } from "../../ui/Textarea";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { refundableRemaining, roundMoney } from "./paymentCalculations";
import { ledgerPaymentMethods, type LedgerPayment, type LedgerPaymentMethod } from "./paymentTypes";
import { useRecordRefund } from "./usePayments";

type RefundFormValues = {
  amount: number;
  paidAt: string;
  paymentMethod: LedgerPaymentMethod;
  note: string;
};

type RefundFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  original: LedgerPayment | null;
  allPayments: LedgerPayment[];
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

function defaultPaidAt() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function RefundFormDialog({ open, onOpenChange, original, allPayments }: RefundFormDialogProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const remaining = original ? refundableRemaining(original, allPayments) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("finance.payments.dialogs.refundTitle")}</DialogTitle>
          <DialogDescription>
            {original
              ? t("finance.payments.dialogs.refundDescription", {
                  amount: formatMoney(original.amount),
                  remaining: formatMoney(remaining),
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        {open && original && (
          <RefundForm
            key={original.id}
            original={original}
            remaining={remaining}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RefundForm({
  original,
  remaining,
  onDone,
}: {
  original: LedgerPayment;
  remaining: number;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { currency, formatMoney } = useWorkspaceMoney();
  const { mutate: record, isPending } = useRecordRefund();
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RefundFormValues>({
    defaultValues: {
      amount: remaining > 0 ? remaining : undefined as unknown as number,
      paidAt: defaultPaidAt(),
      paymentMethod: original.paymentMethod,
      note: "",
    },
  });

  function onSubmit(values: RefundFormValues) {
    if (isPending) return;
    record(
      {
        originalPaymentId: original.id,
        amount: values.amount,
        currencyCode: currency,
        paymentMethod: values.paymentMethod,
        paidAt: new Date(values.paidAt).toISOString(),
        note: values.note,
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-4 py-2">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="refund-amount">{t("finance.payments.fields.amount", { currency })}</Label>
            <Input
              id="refund-amount"
              type="number"
              min={0.01}
              step="0.01"
              max={remaining > 0 ? remaining : undefined}
              {...register("amount", {
                valueAsNumber: true,
                required: t("finance.payments.validation.amountRequired"),
                validate: (value) => {
                  if (!Number.isFinite(value) || value <= 0) return t("finance.payments.validation.amountPositive");
                  if (roundMoney(value - remaining) > 0.005) {
                    return t("finance.payments.validation.amountExceedsRemaining", { remaining: formatMoney(remaining) });
                  }
                  return true;
                },
              })}
              className={errors.amount ? "border-destructive" : ""}
              disabled={isPending || remaining <= 0}
            />
            <FieldError message={errors.amount?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="refund-paid-at">{t("finance.payments.fields.paidAt")}</Label>
            <Input
              id="refund-paid-at"
              type="datetime-local"
              {...register("paidAt", { required: t("finance.payments.validation.dateRequired") })}
              className={errors.paidAt ? "border-destructive" : ""}
              disabled={isPending}
            />
            <FieldError message={errors.paidAt?.message} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{t("finance.payments.fields.paymentMethod")}</Label>
          <Controller
            control={control}
            name="paymentMethod"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={isPending}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ledgerPaymentMethods.map((method) => (
                    <SelectItem key={method} value={method}>
                      {t(`finance.paymentMethods.full.${method}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="refund-note">{t("finance.payments.fields.note")}</Label>
          <Textarea
            id="refund-note"
            rows={2}
            {...register("note", {
              maxLength: { value: 500, message: t("finance.payments.validation.noteTooLong") },
            })}
            disabled={isPending}
          />
          <FieldError message={errors.note?.message} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={isPending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isPending || remaining <= 0}>
          {isPending ? <Spinner className="size-4" /> : null}
          {t("finance.payments.refund")}
        </Button>
      </div>
    </form>
  );
}
