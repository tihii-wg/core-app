import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import type { InvoiceStatus } from "../../lib/types";
import { updateInvoiceStatus } from "../../services/apiInvoices";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function useUpdateInvoiceStatus() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: ({ invoiceId, status }: { invoiceId: string; status: InvoiceStatus }) => updateInvoiceStatus(invoiceId, status, workspaceId),
    onSuccess: (invoice) => {
      toast.success(i18n.t(`invoices.toast.statusChanged.${invoice.status}`, { number: invoice.invoiceNumber }), { id: "update-invoice-status" });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("invoices.toast.statusFailed"), { id: "update-invoice-status" });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["invoices", workspaceId] }),
  });
}
