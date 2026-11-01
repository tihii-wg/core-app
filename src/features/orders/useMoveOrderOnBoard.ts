import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { moveOrderOnBoard } from "../../services/apiOrderBoard";
import type { OrderStatus } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export type MoveOrderOnBoardInput = {
  orderId: string;
  status: OrderStatus;
  customStatusId: string | null;
  currentStatus: OrderStatus;
};

export function useMoveOrderOnBoard() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: (input: MoveOrderOnBoardInput) => {
      guardWrite();
      return moveOrderOnBoard(input, workspaceId);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId] });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("orders.toast.statusUpdateFailed"), { id: "move-order-board" });
    },
  });
}
