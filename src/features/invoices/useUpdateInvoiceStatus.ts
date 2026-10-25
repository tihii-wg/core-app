import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import type { InvoiceStatus } from "../../lib/types";
import { updateInvoiceStatus } from "../../services/apiInvoices";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function useUpdateInvoiceStatus() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: ({ invoiceId, status }: { invoiceId: string; status: InvoiceStatus }) => {
      guardWrite();
      return updateInvoiceStatus(invoiceId, status, workspaceId);
    },
    onSuccess: (invoice) => {
      toast.success(i18n.t(`invoices.toast.statusChanged.${invoice.status}`, { number: invoice.invoiceNumber }), { id: "update-invoice-status" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("invoices.toast.statusFailed"), { id: "update-invoice-status" });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["invoices", workspaceId] }),
  });
}
