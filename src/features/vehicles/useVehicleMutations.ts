import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import type { Vehicle, VehicleInput } from "../../lib/types";
import { archiveVehicle, createVehicle, updateVehicle } from "../../services/apiVehicles";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { clientVehiclesQueryKey } from "./useGetClientVehicles";
import { vehicleQueryKey } from "./useGetVehicle";

export function useCreateVehicle(clientId: string) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: VehicleInput) => {
      guardWrite();
      return createVehicle(workspaceId, clientId, input);
    },
    onMutate: () => toast.loading(i18n.t("vehicles.toast.creating"), { id: "vehicle-mutate" }),
    onSuccess: (created) => {
      // Keep the new row available immediately so order forms can select it before refetch settles.
      queryClient.setQueryData(clientVehiclesQueryKey(workspaceId, clientId), (previous: Vehicle[] | undefined) => {
        const list = previous ?? [];
        if (list.some((vehicle) => vehicle.id === created.id)) return list;
        return [created, ...list];
      });
      void queryClient.invalidateQueries({ queryKey: ["vehicles", workspaceId] });
      toast.success(i18n.t("vehicles.toast.created"), { id: "vehicle-mutate" });
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "vehicle-mutate" });
    },
  });
}

export function useUpdateVehicle(clientId: string) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: ({ vehicleId, input }: { vehicleId: string; input: VehicleInput }) => {
      guardWrite();
      return updateVehicle(workspaceId, vehicleId, input);
    },
    onMutate: () => toast.loading(i18n.t("vehicles.toast.updating"), { id: "vehicle-mutate" }),
    onSuccess: (updated, variables) => {
      queryClient.setQueryData(vehicleQueryKey(workspaceId, variables.vehicleId), updated);
      void queryClient.invalidateQueries({ queryKey: clientVehiclesQueryKey(workspaceId, clientId) });
      void queryClient.invalidateQueries({ queryKey: vehicleQueryKey(workspaceId, variables.vehicleId) });
      toast.success(i18n.t("vehicles.toast.updated"), { id: "vehicle-mutate" });
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "vehicle-mutate" });
    },
  });
}

export function useArchiveVehicle(clientId: string) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (vehicleId: string) => {
      guardWrite();
      return archiveVehicle(workspaceId, vehicleId);
    },
    onMutate: () => toast.loading(i18n.t("vehicles.toast.archiving"), { id: "vehicle-mutate" }),
    onSuccess: (_data, vehicleId) => {
      void queryClient.invalidateQueries({ queryKey: clientVehiclesQueryKey(workspaceId, clientId) });
      void queryClient.invalidateQueries({ queryKey: ["vehicles", workspaceId, "id", vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      toast.success(i18n.t("vehicles.toast.archived"), { id: "vehicle-mutate" });
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "vehicle-mutate" });
    },
  });
}
