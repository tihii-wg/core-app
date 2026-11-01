import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  createLocation,
  deleteLocation,
  setDefaultLocation,
  updateLocation,
  type LocationInput,
} from "../../services/apiLocations";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

function useLocationMutation<TVariables>(
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
      void queryClient.invalidateQueries({ queryKey: ["locations", workspaceId] });
      toast.success(successMessage());
    },
    onError: (error: Error) => toast.error(error.message || i18n.t("common.somethingWentWrong")),
  });
}

export function useCreateLocation() {
  return useLocationMutation<LocationInput>((input, ws) => createLocation(input, ws), () => i18n.t("settings.locations.toast.created"));
}

export function useUpdateLocation() {
  return useLocationMutation<{ id: string; input: Partial<LocationInput> }>(
    ({ id, input }, ws) => updateLocation(id, input, ws),
    () => i18n.t("settings.locations.toast.updated"),
  );
}

export function useSetDefaultLocation() {
  return useLocationMutation<string>((id, ws) => setDefaultLocation(id, ws), () => i18n.t("settings.locations.toast.defaultSet"));
}

export function useDeleteLocation() {
  return useLocationMutation<string>((id, ws) => deleteLocation(id, ws), () => i18n.t("settings.locations.toast.deleted"));
}
