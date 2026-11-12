import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import type { Order } from "../../lib/types";
import { setOrderLineComment } from "../../services/apiOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { withOrderLineComment } from "./orderLineComments";
import { patchOrderLists } from "./orderCache";

type Vars = {
  orderId: string;
  kind: "service" | "material";
  lineId: string;
  body: string | null;
  order: Order;
};

export function useSetOrderLineComment(onOrderUpdated?: (order: Order) => void) {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ orderId, kind, lineId, body, order }: Vars) => {
      await setOrderLineComment(orderId, kind, lineId, body, workspaceId);
      const cached = queryClient.getQueryData<Order>(["order", orderId]) ?? order;
      return withOrderLineComment(cached, kind, lineId, body);
    },
    onMutate: async (vars) => {
      const previous = queryClient.getQueryData<Order>(["order", vars.orderId]) ?? vars.order;
      const optimistic = withOrderLineComment(previous, vars.kind, vars.lineId, vars.body);
      queryClient.setQueryData(["order", vars.orderId], optimistic);
      if (workspaceId) {
        patchOrderLists(queryClient, workspaceId, (cached) =>
          cached.id === vars.orderId ? optimistic : cached,
        );
      }
      onOrderUpdated?.(optimistic);
      return { previous };
    },
    onError: (error, vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["order", vars.orderId], context.previous);
        if (workspaceId) {
          patchOrderLists(queryClient, workspaceId, (cached) =>
            cached.id === vars.orderId ? context.previous! : cached,
          );
        }
        onOrderUpdated?.(context.previous);
      }
      toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
    },
    onSuccess: (order) => {
      queryClient.setQueryData(["order", order.id], order);
      onOrderUpdated?.(order);
    },
  });
}
