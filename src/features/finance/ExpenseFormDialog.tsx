import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Spinner } from "../../ui/Spinner";
import { Textarea } from "../../ui/Textarea";
import { paymentMethods, type Expense, type ExpenseFormData } from "../../lib/types";
import { localDateKey } from "../../pages/dashboardStats";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useCreateExpense, useUpdateExpense } from "./useExpenses";

const suggestedCategoryKeys = ["parts", "rent", "utilities", "salaries", "tools", "marketing", "taxes", "other"] as const;

type ExpenseFormDialogProps = {
  open: boolean;
  expense?: Expense | null;
  knownCategories: string[];
  onOpenChange: (open: boolean) => void;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

export function ExpenseFormDialog({ open, expense, knownCategories, onOpenChange }: ExpenseFormDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{expense ? t("finance.expenses.dialogs.editTitle") : t("finance.expenses.dialogs.addTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("finance.expenses.dialogs.description")}</DialogDescription>
        </DialogHeader>
        {open && <ExpenseForm key={expense?.id ?? "new"} expense={expense ?? null} knownCategories={knownCategories} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ExpenseForm({ expense, knownCategories, onDone }: { expense: Expense | null; knownCategories: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const { currency } = useWorkspaceMoney();
  const { mutate: create, isPending: isCreating } = useCreateExpense();
  const { mutate: update, isPending: isUpdating } = useUpdateExpense();
  const saving = isCreating || isUpdating;
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ExpenseFormData>({
    defaultValues: expense
      ? { date: expense.date, category: expense.category, description: expense.description, amount: expense.amount, paymentMethod: expense.paymentMethod }
      : { date: localDateKey(new Date()), category: "", description: "", amount: undefined as unknown as number, paymentMethod: "cash" },
  });

  const suggestions = [...new Set([...suggestedCategoryKeys.map((key) => t(`finance.expenses.suggestedCategories.${key}`)), ...knownCategories])];

  function onSubmit(input: ExpenseFormData) {
    if (expense) update({ id: expense.id, input }, { onSuccess: onDone });
    else create(input, { onSuccess: onDone });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-4 py-2">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="expense-date">{t("finance.expenses.fields.date")}</Label>
            <Input id="expense-date" type="date" {...register("date", { required: t("finance.expenses.validation.dateRequired") })} className={errors.date ? "border-destructive" : ""} disabled={saving} />
            <FieldError message={errors.date?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expense-amount">{t("finance.expenses.fields.amount", { currency })}</Label>
            <Input
              id="expense-amount"
              type="number"
              min={0.01}
              step="0.01"
              placeholder="0.00"
              {...register("amount", {
                valueAsNumber: true,
                required: t("finance.expenses.validation.amountRequired"),
                validate: (value) => (Number.isFinite(value) && value > 0) || t("finance.expenses.validation.amountPositive"),
              })}
              className={errors.amount ? "border-destructive" : ""}
              disabled={saving}
            />
            <FieldError message={errors.amount?.message} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expense-category">{t("finance.expenses.fields.category")}</Label>
          <Input
            id="expense-category"
            list="expense-category-suggestions"
            autoComplete="off"
            placeholder={t("finance.expenses.fields.categoryPlaceholder")}
            {...register("category", {
              required: t("finance.expenses.validation.categoryRequired"),
              validate: (value) => value.trim().length > 0 || t("finance.expenses.validation.categoryRequired"),
              maxLength: { value: 80, message: t("finance.expenses.validation.categoryTooLong") },
            })}
            className={errors.category ? "border-destructive" : ""}
            disabled={saving}
          />
          <datalist id="expense-category-suggestions">
            {suggestions.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
          <FieldError message={errors.category?.message} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expense-method">{t("finance.expenses.fields.paymentMethod")}</Label>
          <Controller
            name="paymentMethod"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={saving}>
                <SelectTrigger id="expense-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((method) => (
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
          <Label htmlFor="expense-description">{t("finance.expenses.fields.description")}</Label>
          <Textarea id="expense-description" rows={3} placeholder={t("finance.expenses.fields.descriptionPlaceholder")} {...register("description", { maxLength: { value: 500, message: t("finance.expenses.validation.descriptionTooLong") } })} disabled={saving} />
          <FieldError message={errors.description?.message} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onDone} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner className="h-4 w-4" /> : expense ? t("common.saveChanges") : t("finance.expenses.add")}
          </Button>
        </div>
      </div>
    </form>
  );
}
