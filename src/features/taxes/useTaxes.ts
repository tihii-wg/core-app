import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { createTax, getTaxes, updateTax, type TaxInput } from "../../services/apiTaxes";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useGetTaxes() {
  const { workspaceId } = useActiveWorkspaceId();
  return useQuery({
    queryKey: ["taxes", workspaceId],
    queryFn: () => getTaxes(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

function useTaxMutation<TVariables>(
  mutationFn: (variables: TVariables, workspaceId: string | undefined) => Promise<unknown>,
  successMessage: () => string,
) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (variables: TVariables) => {
      guardWrite();
      return mutationFn(variables, workspaceId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["taxes", workspaceId] });
      toast.success(successMessage());
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}

export function useCreateTax() {
  return useTaxMutation<TaxInput>((input, ws) => createTax(input, ws), () => i18n.t("settings.taxes.toast.created"));
}

export function useUpdateTax() {
  return useTaxMutation<{ id: string; input: TaxInput }>(({ id, input }, ws) => updateTax(id, input, ws), () => i18n.t("settings.taxes.toast.updated"));
}
