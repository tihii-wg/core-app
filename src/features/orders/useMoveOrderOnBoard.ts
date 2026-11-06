import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { moveOrderOnBoard } from "../../services/apiOrderBoard";
import type { Order, OrderStatus } from "../../lib/types";
import type { StatusDefinition } from "../../services/apiStatusDefinitions";
import type { UpdateOrderStatusResult } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { patchOrderInLists } from "./orderCache";

export type MoveOrderOnBoardInput = {
  orderId: string;
  status: OrderStatus;
  customStatusId: string | null;
  currentStatus: OrderStatus;
};

function customStatusFromCache(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string | undefined,
  customStatusId: string | null,
): { name: string; color: string | null } | null {
  if (!workspaceId || !customStatusId) return null;
  const entries = queryClient.getQueriesData<StatusDefinition[]>({
    queryKey: ["status_definitions", workspaceId],
  });
  for (const [, defs] of entries) {
    if (!Array.isArray(defs)) continue;
    const found = defs.find((d) => d.id === customStatusId);
    if (found) return { name: found.name, color: found.color };
  }
  return null;
}

export function useMoveOrderOnBoard() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: MoveOrderOnBoardInput) => {
      guardWrite();
      return moveOrderOnBoard(input, workspaceId);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["orders", workspaceId] });
      const previous = queryClient.getQueriesData({ queryKey: ["orders", workspaceId] });
      const customStatus = customStatusFromCache(queryClient, workspaceId, input.customStatusId);
      patchOrderInLists(queryClient, workspaceId, input.orderId, {
        status: input.status,
        customStatusId: input.customStatusId,
        customStatus,
      });
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error(error.message || i18n.t("orders.toast.statusUpdateFailed"), { id: "move-order-board" });
    },
    onSuccess: (result: UpdateOrderStatusResult, input) => {
      const patch: Partial<Order> = {
        status: result.status,
        customStatusId: result.customStatusId,
        customStatus: result.customStatus,
      };
      if (Object.prototype.hasOwnProperty.call(result, "closedAt")) {
        patch.closedAt = result.closedAt ?? null;
      }
      patchOrderInLists(queryClient, workspaceId, input.orderId, patch);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId] });
    },
  });
}
