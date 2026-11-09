import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import { Controller, useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { Order } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import { Textarea } from "../../ui/Textarea";
import { cn } from "../../lib/utils";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import {
  shouldOfferPostPaymentStatusStep,
  useOrderStatusChange,
} from "../orders/useOrderStatusChange";
import { orderNetPaidForMinPaid } from "../orders/minPaidStatusGuard";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { roundMoney } from "./paymentCalculations";
import { ledgerPaymentMethods, type LedgerPaymentMethod, type PaymentBalance } from "./paymentTypes";
import { useFinanceAccounts } from "./useFinanceAccounts";
import { useGetPayments, useRecordPayment } from "./usePayments";
import { DEFAULT_VAT_RATE_PERCENT, vatIncludedAmount } from "./vat";

const NO_ACCOUNT = "none";

type PaymentFormValues = {
  amount: number;
  paidAt: string;
  paymentMethod: LedgerPaymentMethod;
  accountId: string;
  note: string;
};

type PaymentFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: "order" | "invoice";
  orderId?: string | null;
  invoiceId?: string | null;
  balance: PaymentBalance;
  /** Optional «Сейчас оплачивается: …» line above the form. */
  currentStageLabel?: string | null;
  /** When set, offers a post-payment status step for open orders. */
  order?: Order | null;
  onOrderUpdated?: (order: Order) => void;
};

export type OrderPaymentFormProps = {
  orderId?: string | null;
  invoiceId?: string | null;
  balance: PaymentBalance;
  /** Called after a successful record (and after any `onRecorded` work finishes). */
  onDone: () => void;
  /**
   * Optional hook for embedders (e.g. Close order) that need the recorded amount.
   * Return `false` to skip the default `onDone` close (post-payment status step).
   */
  onRecorded?: (amount: number) => void | boolean | Promise<void | boolean>;
  /** When false, hides the form Cancel button (parent dialog owns dismiss). Default true. */
  showCancelButton?: boolean;
  /** Optional «Сейчас оплачивается: …» line above the form. */
  currentStageLabel?: string | null;
  /** Rendered after the note field, before the submit row (e.g. order status after payment). */
  extraFields?: React.ReactNode;
  /** Reports the amount being entered (for live min-paid evaluation). */
  onAmountChange?: (amount: number) => void;
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

export function PaymentFormDialog({
  open,
  onOpenChange,
  target,
  orderId,
  invoiceId,
  balance,
  currentStageLabel,
  order = null,
  onOrderUpdated,
}: PaymentFormDialogProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"payment" | "status">("payment");
  const [recordedAmount, setRecordedAmount] = useState(0);
  const [enteredAmount, setEnteredAmount] = useState(0);
  /** null = keep the current status. */
  const [chosenStatusId, setChosenStatusId] = useState<string | null>(null);
  const [statusStepError, setStatusStepError] = useState<string | null>(null);
  const handleAmountChange = useCallback((amount: number) => setEnteredAmount(amount), []);
  const { payments, isLoading: paymentsLoading, isFetching: paymentsFetching, refetch } = useGetPayments();
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  useEffect(() => {
    if (!open) {
      setStep("payment");
      setRecordedAmount(0);
      setEnteredAmount(0);
      setChosenStatusId(null);
      setStatusStepError(null);
    }
  }, [open]);

  const netPaidOverride = useMemo(() => {
    if (!order) return null;
    // Payment form: evaluate min-paid as if the amount being entered were already paid.
    if (step === "payment") return orderNetPaidForMinPaid(order, payments) + enteredAmount;
    // Prefer live ledger after invalidate/refetch; fall back to pre-payment + recorded amount.
    if (!paymentsLoading && !paymentsFetching) {
      return orderNetPaidForMinPaid(order, payments);
    }
    return orderNetPaidForMinPaid(order, payments) + recordedAmount;
  }, [order, step, payments, paymentsLoading, paymentsFetching, recordedAmount, enteredAmount]);

  const statusChange = useOrderStatusChange(order, {
    payments,
    paymentsLoading: paymentsLoading || paymentsFetching,
    netPaidOverride,
    onOrderUpdated,
  });

  const offerStatusStep = shouldOfferPostPaymentStatusStep(order, statusChange.canChangeStatus);

  function closeDialog(nextOpen: boolean) {
    if (!nextOpen) {
      setStep("payment");
      setRecordedAmount(0);
      setEnteredAmount(0);
      setChosenStatusId(null);
      setStatusStepError(null);
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {step === "payment" ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("finance.payments.dialogs.paymentTitle")}</DialogTitle>
              <DialogDescription>
                {t("finance.payments.dialogs.paymentDescription", {
                  target:
                    target === "order"
                      ? t("finance.payments.dialogs.targetOrder")
                      : t("finance.payments.dialogs.targetInvoice"),
                })}
              </DialogDescription>
            </DialogHeader>
            {open && (
              <OrderPaymentForm
                key={`${orderId ?? ""}:${invoiceId ?? ""}:${balance.remaining}`}
                orderId={orderId}
                invoiceId={invoiceId}
                balance={balance}
                currentStageLabel={currentStageLabel}
                onDone={() => closeDialog(false)}
                onAmountChange={handleAmountChange}
                extraFields={
                  offerStatusStep && order ? (
                    <StatusAfterPaymentField
                      statusChange={statusChange}
                      value={chosenStatusId}
                      onChange={setChosenStatusId}
                    />
                  ) : null
                }
                onRecorded={async (amount) => {
                  if (!offerStatusStep || !order || !chosenStatusId) return;
                  setRecordedAmount(amount);
                  void queryClient.invalidateQueries({ queryKey: ["payments", workspaceId] });
                  void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
                  await refetch();
                  const option = statusChange.options.find((item) => item.id === chosenStatusId);
                  const result = await statusChange.changeTo(chosenStatusId);
                  if (result.ok) {
                    toast.success(
                      t("finance.payments.afterPayment.recordedWithStatus", { status: option?.name ?? "" }),
                      { id: "post-payment-status" },
                    );
                    return;
                  }
                  // Payment is saved; let the user pick another status or keep the current one.
                  setStatusStepError(result.reason);
                  setStep("status");
                  return false;
                }}
              />
            )}
          </>
        ) : (
          <PostPaymentStatusStep
            statusChange={statusChange}
            initialError={statusStepError}
            onKeep={() => closeDialog(false)}
            onChanged={() => closeDialog(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const KEEP_STATUS = "__keep__";

/** «Статус заказа после оплаты» select shown inside the payment form. */
function StatusAfterPaymentField({
  statusChange,
  value,
  onChange,
}: {
  statusChange: ReturnType<typeof useOrderStatusChange>;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const { t } = useTranslation();
  const currentLabel = statusChange.current?.name ?? "—";
  const choices = statusChange.options.filter((option) => option.id !== statusChange.current?.id);
  const selected = value ? choices.find((option) => option.id === value) : undefined;

  // Drop a choice that became unavailable (e.g. amount lowered below the min-paid threshold).
  useEffect(() => {
    if (value && (!selected || selected.disabled)) onChange(null);
  }, [value, selected, onChange]);

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3">
      <Label htmlFor="payment-order-status">{t("finance.payments.afterPayment.fieldLabel")}</Label>
      <Select value={value ?? KEEP_STATUS} onValueChange={(next) => onChange(next === KEEP_STATUS ? null : next)}>
        <SelectTrigger id="payment-order-status" className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={KEEP_STATUS}>{t("finance.payments.afterPayment.keepCurrent", { status: currentLabel })}</SelectItem>
          {choices.map((option) => (
            <SelectItem key={option.id} value={option.id} disabled={option.disabled}>
              <span className="flex min-w-0 flex-col">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-border"
                    style={option.color ? { backgroundColor: option.color } : undefined}
                  />
                  <span className="truncate">{option.name}</span>
                </span>
                {option.disabled && option.disabledReason ? (
                  <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{option.disabledReason}</span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{t("finance.payments.afterPayment.fieldHint")}</p>
    </div>
  );
}

function PostPaymentStatusStep({
  statusChange,
  initialError = null,
  onKeep,
  onChanged,
}: {
  statusChange: ReturnType<typeof useOrderStatusChange>;
  initialError?: string | null;
  onKeep: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(initialError);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const currentLabel = statusChange.current?.name ?? "—";

  async function pickStatus(optionId: string) {
    if (statusChange.isPending || pendingId) return;
    const option = statusChange.options.find((item) => item.id === optionId);
    if (!option || option.disabled) {
      setError(option?.disabledReason ?? t("orders.errors.statusChangeUnavailable"));
      return;
    }
    setError(null);
    setPendingId(optionId);
    const result = await statusChange.changeTo(optionId);
    setPendingId(null);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    toast.success(t("finance.payments.afterPayment.statusChanged", { status: option.name }), {
      id: "post-payment-status",
    });
    onChanged();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("finance.payments.afterPayment.title")}</DialogTitle>
        <DialogDescription>{t("finance.payments.afterPayment.subtitle")}</DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-2">
        <ul className="flex flex-col gap-2">
          {statusChange.options.map((option) => {
            const isCurrent = statusChange.current?.id === option.id;
            const busy = pendingId != null;
            return (
              <li key={option.id}>
                <button
                  type="button"
                  disabled={option.disabled || busy || statusChange.isPending}
                  onClick={() => void pickStatus(option.id)}
                  className={cn(
                    "flex min-h-11 w-full items-start gap-3 rounded-md border border-border px-3 py-2.5 text-left transition-colors",
                    option.disabled
                      ? "cursor-not-allowed bg-muted/40 text-muted-foreground"
                      : "bg-background hover:bg-muted/50",
                    pendingId === option.id ? "opacity-70" : null,
                  )}
                >
                  {option.color ? (
                    <span
                      aria-hidden
                      className="mt-1.5 size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-border"
                      style={{ backgroundColor: option.color }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="mt-1.5 size-2.5 shrink-0 rounded-full bg-muted ring-1 ring-inset ring-border"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">{option.name}</span>
                      {isCurrent ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {t("finance.payments.afterPayment.currentBadge")}
                        </span>
                      ) : null}
                      {pendingId === option.id ? <Spinner className="size-3.5" /> : null}
                    </span>
                    {option.disabled && option.disabledReason ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {option.disabledReason}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          disabled={pendingId != null || statusChange.isPending}
          onClick={onKeep}
        >
          {t("finance.payments.afterPayment.keepCurrent", { status: currentLabel })}
        </Button>
      </div>
    </>
  );
}

/** Reusable order/invoice payment form — embedded by CloseOrderDialog and PaymentFormDialog. */
export function OrderPaymentForm({
  orderId,
  invoiceId,
  balance,
  onDone,
  onRecorded,
  showCancelButton = true,
  currentStageLabel,
  extraFields,
  onAmountChange,
}: OrderPaymentFormProps) {
  const { t } = useTranslation();
  const { currency, formatMoney } = useWorkspaceMoney();
  const { mutate: record, isPending } = useRecordPayment();
  const remaining = balance.remaining;
  const { data: financeAccounts = [] } = useFinanceAccounts();
  const accountOptions = financeAccounts.filter((account) => account.isActive && account.currencyCode === currency);
  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<PaymentFormValues>({
    defaultValues: {
      amount: remaining > 0 ? remaining : (undefined as unknown as number),
      paidAt: defaultPaidAt(),
      paymentMethod: "cash",
      accountId: NO_ACCOUNT,
      note: "",
    },
  });
  const enteredAmount = watch("amount");
  useEffect(() => {
    const value = Number(enteredAmount);
    onAmountChange?.(Number.isFinite(value) && value > 0 ? value : 0);
  }, [enteredAmount, onAmountChange]);

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
        accountId: values.accountId && values.accountId !== NO_ACCOUNT ? values.accountId : null,
      },
      {
        onSuccess: () => {
          void (async () => {
            let skipDone = false;
            try {
              const result = await onRecorded?.(values.amount);
              if (result === false) skipDone = true;
            } finally {
              if (!skipDone) onDone();
            }
          })();
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-4 py-2">
        {currentStageLabel ? (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground" role="status">
            {currentStageLabel}
          </p>
        ) : null}
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
            {Number.isFinite(enteredAmount) && enteredAmount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("finance.payments.vatIncluded", {
                  rate: DEFAULT_VAT_RATE_PERCENT,
                  amount: formatMoney(vatIncludedAmount(enteredAmount)),
                })}
              </p>
            ) : null}
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

        {accountOptions.length > 0 ? (
          <div className="space-y-1.5">
            <Label>{t("finance.payments.fields.account")}</Label>
            <Controller
              control={control}
              name="accountId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={isPending}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ACCOUNT}>{t("finance.payments.fields.accountNone")}</SelectItem>
                    {accountOptions.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        ) : null}

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

        {extraFields}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {showCancelButton ? (
          <Button type="button" variant="outline" onClick={onDone} disabled={isPending}>
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button type="submit" disabled={isPending || remaining <= 0}>
          {isPending ? <Spinner className="size-4" /> : null}
          {t("finance.payments.record")}
        </Button>
      </div>
    </form>
  );
}
