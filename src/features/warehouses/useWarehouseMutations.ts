import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  createWarehouse,
  setDefaultWarehouse,
  softDeleteWarehouse,
  updateWarehouse,
  type WarehouseInput,
} from "../../services/apiWarehouses";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

function useWarehouseMutation<TVariables>(
  mutationFn: (variables: TVariables, workspaceId: string | undefined) => Promise<unknown>,
  successMessage: () => string,
) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return useMutation({
    mutationFn: (variables: TVariables) => {
      guardWrite();
      return mutationFn(variables, workspaceId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["warehouses", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["warehouse-stock", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["bin-locations", workspaceId] });
      toast.success(successMessage());
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}

export function useCreateWarehouse() {
  return useWarehouseMutation<WarehouseInput>((input, ws) => createWarehouse(input, ws), () => i18n.t("settings.warehouses.toast.created"));
}

export function useUpdateWarehouse() {
  return useWarehouseMutation<{ id: string; input: WarehouseInput }>(
    ({ id, input }, ws) => updateWarehouse(id, input, ws),
    () => i18n.t("settings.warehouses.toast.updated"),
  );
}

export function useSetDefaultWarehouse() {
  return useWarehouseMutation<string>((id, ws) => setDefaultWarehouse(id, ws), () => i18n.t("settings.warehouses.toast.defaultSet"));
}

export function useSoftDeleteWarehouse() {
  return useWarehouseMutation<string>((id, ws) => softDeleteWarehouse(id, ws), () => i18n.t("settings.warehouses.toast.deleted"));
}
