import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { getInventoryMarkup, updateInventoryMarkup } from "../../services/apiInventoryMarkup";

export function useGetInventoryMarkup(workspaceId?: string) {
  return useQuery({
    queryKey: ["workspace-markup", workspaceId],
    queryFn: () => getInventoryMarkup(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
  });
}

export function useUpdateInventoryMarkup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workspaceId, markupPercent }: { workspaceId: string; markupPercent: number }) => updateInventoryMarkup(workspaceId, markupPercent),
    onSuccess(markupPercent, { workspaceId }) {
      queryClient.setQueryData(["workspace-markup", workspaceId], markupPercent);
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError(error) {
      toast.error(error.message || i18n.t("settings.company.toast.markupSaveFailed"));
    },
  });
}
