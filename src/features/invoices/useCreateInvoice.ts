import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { createInvoiceFromOrder } from "../../services/apiInvoices";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: (orderId: string) => createInvoiceFromOrder(orderId, workspaceId),
    onMutate: () => {
      toast.loading(i18n.t("invoices.toast.creating"), { id: "create-invoice" });
    },
    onSuccess: (invoice) => {
      toast.success(i18n.t("invoices.toast.created", { number: invoice.invoiceNumber }), { id: "create-invoice" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "create-invoice" });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["invoices", workspaceId] }),
  });
}
