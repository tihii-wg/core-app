import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import type { Expense } from "../../lib/types";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useDeleteExpense } from "./useExpenses";

export function DeleteExpenseDialog({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const { mutate: deleteExpense, isPending } = useDeleteExpense();

  return (
    <Dialog
      open={Boolean(expense)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("finance.expenses.dialogs.deleteTitle")}</DialogTitle>
          <DialogDescription>{t("finance.expenses.dialogs.deleteDescription", { category: expense?.category ?? "", amount: formatMoney(expense?.amount) })}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={isPending} onClick={() => expense && deleteExpense(expense.id, { onSuccess: onClose })}>
            {isPending ? t("common.deleting") : t("common.delete")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
