import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { printOrderDocument } from "../../services/apiDocumentTemplates";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export function usePrintOrderDocument() {
  const { workspaceId } = useActiveWorkspaceId();
  return useMutation({
    mutationFn: ({ orderId, templateId }: { orderId: string; templateId: string }) =>
      printOrderDocument(orderId, templateId, workspaceId),
    onSuccess: (result) => {
      if (result === "unavailable") toast.error(i18n.t("orders.print.unavailable"));
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"));
    },
  });
}
