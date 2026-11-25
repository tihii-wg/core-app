import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import type { Vehicle, VehicleInput } from "../../lib/types";
import { archiveVehicle, createVehicle, transferVehicleToClient, updateVehicle, type VehicleTransferResult, type VinOwnerMatch } from "../../services/apiVehicles";
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
      // Drop it from the card at once, then refresh every vehicle view (client lists, the vehicle,
      // plate search, VIN owner checks, merge counters). Orders keep their own VIN / plate copy, so the
      // whole orders cache is not refetched for this.
      queryClient.setQueryData(clientVehiclesQueryKey(workspaceId, clientId), (previous: Vehicle[] | undefined) =>
        previous ? previous.filter((vehicle) => vehicle.id !== vehicleId) : previous,
      );
      void queryClient.invalidateQueries({ queryKey: ["vehicles", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["vehicle-vin-owner", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["vehicle-order-counts", workspaceId] });
      toast.success(i18n.t("vehicles.toast.archived"), { id: "vehicle-mutate" });
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "vehicle-mutate" });
    },
  });
}

/** Change of owner: moves an existing vehicle (found by VIN) to `clientId` with the previous owner's orders for it. */
export function useTransferVehicle(clientId: string) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: ({ match, licensePlate }: { match: VinOwnerMatch; licensePlate?: string | null }) => {
      guardWrite();
      return transferVehicleToClient(workspaceId, match.vehicleId, clientId, { licensePlate });
    },
    onSuccess: (result, { match }) => {
      applyVehicleTransferToCache(queryClient, workspaceId, clientId, match, result);
      notifyVehicleTransfer(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "vehicle-mutate" });
    },
  });
}

/** Cache after a change of owner: lists of both clients, the vehicle, VIN lookups, orders and clients (counts). */
export function applyVehicleTransferToCache(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  clientId: string,
  match: VinOwnerMatch,
  result: VehicleTransferResult,
) {
  const { vehicle } = result;
  queryClient.setQueryData(clientVehiclesQueryKey(workspaceId, clientId), (previous: Vehicle[] | undefined) => {
    const list = previous ?? [];
    return list.some((row) => row.id === vehicle.id) ? list.map((row) => (row.id === vehicle.id ? vehicle : row)) : [vehicle, ...list];
  });
  queryClient.setQueryData(clientVehiclesQueryKey(workspaceId, match.clientId), (previous: Vehicle[] | undefined) =>
    previous ? previous.filter((row) => row.id !== vehicle.id) : previous,
  );
  queryClient.setQueryData(vehicleQueryKey(workspaceId, vehicle.id), vehicle);
  void queryClient.invalidateQueries({ queryKey: ["vehicle-vin-owner", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["vehicles", workspaceId] });
  if (result.movedOrders) {
    void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
  }
}

export function notifyVehicleTransfer(result: VehicleTransferResult) {
  if (result.movedOrders == null) {
    toast.success(i18n.t("vehicles.vinOwner.transferDoneNoOrders"), { id: "vehicle-mutate", duration: 8000 });
  } else if (result.movedOrders > 0) {
    toast.success(i18n.t("vehicles.vinOwner.transferDoneWithOrders", { count: result.movedOrders }), { id: "vehicle-mutate" });
  } else {
    toast.success(i18n.t("vehicles.vinOwner.transferDone"), { id: "vehicle-mutate" });
  }
}
