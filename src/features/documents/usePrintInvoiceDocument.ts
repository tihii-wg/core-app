import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { printInvoiceDocument } from "../../services/apiDocumentTemplates";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function usePrintInvoiceDocument() {
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: ({ invoiceId, templateId }: { invoiceId: string; templateId: string }) =>
      printInvoiceDocument(invoiceId, templateId, workspaceId),
    onSuccess: (result) => {
      if (result === "unavailable") toast.error(i18n.t("invoices.print.unavailable"));
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"));
    },
  });
}
