import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { deleteErroneousInvoice } from "../../services/apiInvoices";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useDeleteErroneousInvoice() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (invoiceId: string) => {
      guardWrite();
      return deleteErroneousInvoice(invoiceId, workspaceId);
    },
    onSuccess: (result) => {
      toast.success(i18n.t("invoices.toast.erroneousDeleted", { number: result.invoiceNumber }), {
        id: "delete-erroneous-invoice",
      });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("invoices.toast.erroneousDeleteFailed"), {
        id: "delete-erroneous-invoice",
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["payments", workspaceId] });
    },
  });
}
