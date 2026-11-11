import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  changeOrderClient,
  type ChangeOrderClientInput,
} from "../../services/apiOrders";
import { clientOrdersCountQueryKey } from "../clients/useClientOrdersCount";
import { clientQueryKey } from "../clients/useGetClient";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { clientVehiclesQueryKey } from "../vehicles/useGetClientVehicles";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { invalidateOrderFieldQueries, ORDER_FIELD_SAVED_TOAST_ID } from "./useUpdateOrderFields";

/** Invalidate order + both client cards (orders/balance/payments/documents/vehicles) and reports. */
export function invalidateAfterOrderClientChange(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  orderId: string,
  clientIds: Array<string | null | undefined>,
) {
  invalidateOrderFieldQueries(queryClient, workspaceId, orderId);
  queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["invoices", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["payments", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["vehicles", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["reports", workspaceId] });
  for (const raw of clientIds) {
    const id = raw?.trim();
    if (!id) continue;
    queryClient.invalidateQueries({ queryKey: clientQueryKey(workspaceId, id) });
    queryClient.invalidateQueries({ queryKey: clientOrdersCountQueryKey(workspaceId, id) });
    queryClient.invalidateQueries({ queryKey: ["client_extensions", workspaceId, id] });
    queryClient.invalidateQueries({ queryKey: clientVehiclesQueryKey(workspaceId, id) });
  }
}

export function useChangeOrderClient() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: { orderId: string; patch: ChangeOrderClientInput; previousClientId?: string | null }) => {
      guardWrite();
      return changeOrderClient(input.orderId, input.patch, workspaceId);
    },
    onSuccess: (order, variables) => {
      invalidateAfterOrderClientChange(queryClient, workspaceId, variables.orderId, [
        variables.previousClientId,
        order.clientId,
        variables.patch.clientId,
      ]);
      toast.success(i18n.t("orders.toast.fieldSaved"), { id: ORDER_FIELD_SAVED_TOAST_ID });
    },
  });
}
