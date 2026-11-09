import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { mergeClients, mergeClientsPreview } from "../../services/apiClients";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useMergeClientsPreview() {
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: { targetClientId: string; sourceClientIds: string[] }) => {
      guardWrite();
      return mergeClientsPreview(workspaceId, input.targetClientId, input.sourceClientIds);
    },
  });
}

export function useMergeClients() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: { targetClientId: string; sourceClientIds: string[]; newName: string }) => {
      guardWrite();
      return mergeClients(workspaceId, input.targetClientId, input.sourceClientIds, input.newName);
    },
    onMutate: () => {
      toast.loading(i18n.t("clients.merge.toast.merging"), { id: "merge-clients" });
    },
    onSuccess: () => {
      // Merge re-points every table that references the client (orders, vehicles,
      // invoices, payments, warranty, warehouse, leads, bookings, extras…). It is a
      // rare action, so refresh everything instead of maintaining a key list.
      void queryClient.invalidateQueries();
      toast.success(i18n.t("clients.merge.toast.merged"), { id: "merge-clients" });
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "merge-clients" });
    },
  });
}
