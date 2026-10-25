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
import { roundMoney } from "./paymentCalculations";
import { ledgerPaymentMethods, type LedgerPaymentMethod, type PaymentBalance } from "./paymentTypes";
import { useRecordPayment } from "./usePayments";

type PaymentFormValues = {
  amount: number;
  paidAt: string;
  paymentMethod: LedgerPaymentMethod;
  note: string;
};

type PaymentFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: "order" | "invoice";
  orderId?: string | null;
  invoiceId?: string | null;
  balance: PaymentBalance;
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

export function PaymentFormDialog({ open, onOpenChange, target, orderId, invoiceId, balance }: PaymentFormDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("finance.payments.dialogs.paymentTitle")}</DialogTitle>
          <DialogDescription>
            {t("finance.payments.dialogs.paymentDescription", {
              target: target === "order" ? t("finance.payments.dialogs.targetOrder") : t("finance.payments.dialogs.targetInvoice"),
            })}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <PaymentForm
            key={`${orderId ?? ""}:${invoiceId ?? ""}:${balance.remaining}`}
            orderId={orderId}
            invoiceId={invoiceId}
            balance={balance}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({
  orderId,
  invoiceId,
  balance,
  onDone,
}: {
  orderId?: string | null;
  invoiceId?: string | null;
  balance: PaymentBalance;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { currency, formatMoney } = useWorkspaceMoney();
  const { mutate: record, isPending } = useRecordPayment();
  const remaining = balance.remaining;
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PaymentFormValues>({
    defaultValues: {
      amount: remaining > 0 ? remaining : undefined as unknown as number,
      paidAt: defaultPaidAt(),
      paymentMethod: "cash",
      note: "",
    },
  });

  function onSubmit(values: PaymentFormValues) {
    if (isPending) return;
    record(
      {
        orderId: orderId ?? null,
        invoiceId: invoiceId ?? null,
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
        <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t("finance.payments.amountDue")}</p>
            <p className="font-medium tabular-nums">{formatMoney(balance.total)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("finance.payments.amountPaid")}</p>
            <p className="font-medium tabular-nums">{formatMoney(balance.netPaid)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("finance.payments.remaining")}</p>
            <p className="font-medium tabular-nums">{formatMoney(remaining)}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="payment-amount">{t("finance.payments.fields.amount", { currency })}</Label>
            <Input
              id="payment-amount"
              type="number"
              min={0.01}
              step="0.01"
              max={remaining > 0 ? remaining : undefined}
              placeholder="0.00"
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
            <Label htmlFor="payment-paid-at">{t("finance.payments.fields.paidAt")}</Label>
            <Input
              id="payment-paid-at"
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
            rules={{ required: true }}
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
          <Label htmlFor="payment-note">{t("finance.payments.fields.note")}</Label>
          <Textarea
            id="payment-note"
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
          {t("finance.payments.record")}
        </Button>
      </div>
    </form>
  );
}
