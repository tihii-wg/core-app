import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createService } from "../../services/apiServices";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import type { addNewServiceFormData } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

export default function useCreateNewService() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: (input: addNewServiceFormData) => createService(input, workspaceId),
    onMutate: () => {
      toast.loading(i18n.t("services.toast.creating"), { id: "create-service" });
    },
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["services", workspaceId] });
      toast.success(i18n.t("services.toast.created"), { id: "create-service" });
    },
    onError: (error) => {
      if (error.message === i18n.t("services.errors.duplicateName")) {
        toast.error(i18n.t("services.toast.duplicateName"), { id: "create-service" });
      } else {
        toast.error(error.message || i18n.t("services.toast.genericError"), { id: "create-service" });
      }
    },
  });
}
