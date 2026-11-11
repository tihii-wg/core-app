import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { upsertCustomFieldValues } from "../../services/apiCustomFields";
import { updateOrderFields, type UpdateOrderFieldsPatch } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

/** Toast id shared by every inline field save so rapid edits collapse into one "Saved" toast. */
export const ORDER_FIELD_SAVED_TOAST_ID = "order-field-saved";

/** Query keys that can display an order's inline-editable fields (header, lists, calendars, custom columns). */
export function invalidateOrderFieldQueries(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  orderId: string,
) {
  queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["orders", workspaceId, "awaitingPayment"] });
  queryClient.invalidateQueries({ queryKey: ["orders-page", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["order", orderId] });
  queryClient.invalidateQueries({ queryKey: ["dashboard", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["orders-warranty-indicators", workspaceId] });
  queryClient.invalidateQueries({ queryKey: ["warranty-records", workspaceId] });
  // Same keys as useOrderCustomFieldValues / useOrderCustomFieldValuesForOrders.
  queryClient.invalidateQueries({ queryKey: ["custom-field-values", workspaceId, orderId] });
  queryClient.invalidateQueries({ queryKey: ["custom-field-values-batch", workspaceId] });
}

/**
 * Thin mutation around `updateOrderFields` for click-to-edit fields on the order card.
 *
 * Errors are intentionally NOT toasted here: the inline editor renders the message under the
 * control (the caller reads it from the rejected `mutateAsync` promise), so a toast would duplicate it.
 */
export function useUpdateOrderFields() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: { orderId: string; patch: UpdateOrderFieldsPatch }) => {
      guardWrite();
      return updateOrderFields(input.orderId, input.patch, workspaceId);
    },
    onSuccess: (_order, variables) => {
      invalidateOrderFieldQueries(queryClient, workspaceId, variables.orderId);
      toast.success(i18n.t("orders.toast.fieldSaved"), { id: ORDER_FIELD_SAVED_TOAST_ID });
    },
  });
}

/**
 * Saves one custom field value (existing `upsertCustomFieldValues` API) for click-to-edit.
 * Same contract as `useUpdateOrderFields`: success toast + invalidation, no error toast (shown inline).
 */
export function useUpdateOrderCustomFieldValue() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: { orderId: string; definitionId: string; value: unknown }) => {
      guardWrite();
      return upsertCustomFieldValues(workspaceId, input.orderId, [{ definitionId: input.definitionId, value: input.value }]);
    },
    onSuccess: (_data, variables) => {
      invalidateOrderFieldQueries(queryClient, workspaceId, variables.orderId);
      toast.success(i18n.t("orders.toast.fieldSaved"), { id: ORDER_FIELD_SAVED_TOAST_ID });
    },
  });
}
