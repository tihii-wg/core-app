import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { createInvoiceFromOrder } from "../../services/apiInvoices";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: (orderId: string) => createInvoiceFromOrder(orderId, workspaceId),
    onMutate: () => {
      toast.loading("Creating invoice...", { id: "create-invoice" });
    },
    onSuccess: (invoice) => {
      toast.success(`Invoice ${invoice.invoiceNumber} created`, { id: "create-invoice" });
    },
    onError: (error) => {
      toast.error(error.message || "Something went wrong", { id: "create-invoice" });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["invoices", workspaceId] }),
  });
}
