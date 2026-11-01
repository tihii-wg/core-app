import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  createClientAddress,
  createClientPhone,
  deleteClientAddress,
  deleteClientPhone,
  getClientAddresses,
  getClientBalanceEntries,
  getClientPhones,
  type CreateClientAddressInput,
  type CreateClientPhoneInput,
} from "../../services/apiClientExtensions";
import { deleteClientDiscount, getClientDiscounts, upsertClientDiscount, type UpsertClientDiscountInput } from "../../services/apiClientDiscounts";
import type { ClientDiscountTarget } from "./clientDiscounts";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

function useClientExtension<T>(
  kind: "phones" | "addresses" | "balance" | "discounts",
  clientId: string | null | undefined,
  load: (workspaceId: string | undefined, clientId: string) => Promise<{ available: boolean; rows: T[] }>,
  enabled: boolean,
) {
  const { workspaceId } = useActiveWorkspaceId();
  const id = clientId?.trim() ?? "";

  const query = useQuery({
    queryKey: ["client_extensions", kind, workspaceId, id],
    queryFn: () => load(workspaceId, id),
    enabled: enabled && Boolean(workspaceId && id),
  });

  return {
    rows: query.data?.rows ?? [],
    /** False when the backing table is missing or unreadable (graceful stub). */
    available: query.data?.available ?? true,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/** Each tab only fetches once it has been opened (`enabled`). */
export function useGetClientPhones(clientId: string | null | undefined, enabled = true) {
  return useClientExtension("phones", clientId, getClientPhones, enabled);
}

export function useGetClientAddresses(clientId: string | null | undefined, enabled = true) {
  return useClientExtension("addresses", clientId, getClientAddresses, enabled);
}

export function useGetClientBalanceEntries(clientId: string | null | undefined, enabled = true) {
  return useClientExtension("balance", clientId, getClientBalanceEntries, enabled);
}

export function useGetClientDiscounts(clientId: string | null | undefined, enabled = true) {
  return useClientExtension("discounts", clientId, getClientDiscounts, enabled);
}

/** Write hooks for phones/addresses; each invalidates only its own extension query. */
function useClientExtensionMutation<TInput>(
  kind: "phones" | "addresses" | "discounts",
  clientId: string,
  run: (workspaceId: string | undefined, clientId: string, input: TInput) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: TInput) => {
      guardWrite();
      return run(workspaceId, clientId, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client_extensions", kind, workspaceId, clientId] });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"));
    },
  });
}

export function useCreateClientPhone(clientId: string) {
  return useClientExtensionMutation<CreateClientPhoneInput>("phones", clientId, createClientPhone);
}

export function useCreateClientAddress(clientId: string) {
  return useClientExtensionMutation<CreateClientAddressInput>("addresses", clientId, createClientAddress);
}

export function useDeleteClientPhone(clientId: string) {
  return useClientExtensionMutation<string>("phones", clientId, deleteClientPhone);
}

export function useDeleteClientAddress(clientId: string) {
  return useClientExtensionMutation<string>("addresses", clientId, deleteClientAddress);
}

export function useUpsertClientDiscount(clientId: string) {
  return useClientExtensionMutation<UpsertClientDiscountInput>("discounts", clientId, upsertClientDiscount);
}

export function useDeleteClientDiscount(clientId: string) {
  return useClientExtensionMutation<ClientDiscountTarget>("discounts", clientId, deleteClientDiscount);
}
