import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { createFinanceTransfer, getFinanceAccounts } from "../../services/apiFinanceAccounts";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useFinanceAccounts() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["finance-accounts", workspaceId],
    queryFn: () => getFinanceAccounts(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export function useCreateFinanceTransfer() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: { fromAccountId: string; toAccountId: string; amount: number; comment?: string }) => {
      guardWrite();
      return createFinanceTransfer({ workspaceId, ...input });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance-accounts", workspaceId] });
      toast.success(i18n.t("finance.accounts.transfer.toast.created"));
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("finance.accounts.transfer.errors.failed"));
    },
  });
}
