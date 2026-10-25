import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type { ParseKeys } from "i18next";
import i18n from "../../i18n";
import { createExpense, deleteExpense, ExpensesUnavailableError, getExpenses, updateExpense } from "../../services/apiExpenses";
import type { ExpenseFormData } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useGetExpenses() {
  const { workspaceId } = useActiveWorkspaceId();
  const { data, isLoading, error } = useQuery({
    queryKey: ["expenses", workspaceId],
    queryFn: () => getExpenses(workspaceId),
    enabled: Boolean(workspaceId),
    retry: (failureCount, queryError) => !(queryError instanceof ExpensesUnavailableError) && failureCount < 3,
  });

  return { expenses: data ?? [], isLoading, error, isUnavailable: error instanceof ExpensesUnavailableError };
}

function useExpenseMutation<T>(toastId: string, pendingKey: ParseKeys, doneKey: ParseKeys, mutationFn: (input: T, workspaceId: string | undefined) => Promise<unknown>) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: T) => {
      guardWrite();
      return mutationFn(input, workspaceId);
    },
    onMutate: () => {
      toast.loading(i18n.t(pendingKey), { id: toastId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", workspaceId] });
      toast.success(i18n.t(doneKey), { id: toastId });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("finance.expenses.errors.saveFailed"), { id: toastId });
    },
  });
}

export function useCreateExpense() {
  return useExpenseMutation<ExpenseFormData>("create-expense", "finance.expenses.toast.creating", "finance.expenses.toast.created", createExpense);
}

export function useUpdateExpense() {
  return useExpenseMutation<{ id: string; input: ExpenseFormData }>("update-expense", "finance.expenses.toast.updating", "finance.expenses.toast.updated", ({ id, input }, workspaceId) => updateExpense(id, input, workspaceId));
}

export function useDeleteExpense() {
  return useExpenseMutation<string>("delete-expense", "common.deleting", "finance.expenses.toast.deleted", deleteExpense);
}
