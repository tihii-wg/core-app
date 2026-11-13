import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { createOrder } from "../../services/apiOrders";
import { replaceOrderPaymentStages } from "../../services/apiPaymentStages";
import type { CreateOrderInput } from "../../lib/types";
import { getWorkspace } from "../../services/apiWorkspaces";
import { applyTemplateToStages } from "../finance/paymentStages";
import { invalidatePaymentStageViews } from "../finance/useOrderPaymentStages";
import { industryPaymentStageTemplate, industryProfile } from "../industries/industryProfile";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { notifyOrderCalendarChanged } from "../calendar/pokeCalendarSync";

/** Auto-apply workspace/industry template only when it has more than one stage. */
async function maybeApplyPaymentStageTemplate(
  created: { id?: unknown; createdAt?: unknown; created_at?: unknown },
  workspaceId: string | undefined,
) {
  const orderId = typeof created.id === "string" ? created.id : "";
  const createdAtRaw = created.createdAt ?? created.created_at;
  const createdAt = typeof createdAtRaw === "string" ? createdAtRaw : "";
  if (!workspaceId || !orderId) return;
  try {
    const workspace = await getWorkspace(workspaceId);
    const template =
      workspace?.paymentStageTemplate && workspace.paymentStageTemplate.length > 0
        ? workspace.paymentStageTemplate
        : industryPaymentStageTemplate(industryProfile(workspace?.industrySlug));
    if (template.length <= 1) return;
    const stages = applyTemplateToStages(template, {
      fromDate: createdAt ? new Date(createdAt) : new Date(),
    });
    await replaceOrderPaymentStages(
      orderId,
      workspaceId,
      stages.map((stage) => ({
        name: stage.name,
        mode: stage.mode,
        percent: stage.percent,
        amount: stage.amount,
        dueDate: stage.dueDate,
        position: stage.position,
      })),
    );
  } catch {
    // Soft-fail: order is created; stages can be applied later from the detail panel.
  }
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: async (input: CreateOrderInput) => {
      guardWrite();
      const order = await createOrder(input, workspaceId);
      await maybeApplyPaymentStageTemplate(order, workspaceId);
      return order;
    },
    onMutate: (input) => {
      const estimate = input.kind === "estimate";
      toast.loading(i18n.t(estimate ? "orders.estimates.creating" : "orders.toast.creating"), { id: "create-order" });
    },
    onSuccess: (order, input) => {
      queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["clients", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["services", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["inventory", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["orders-warranty-indicators", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["warranty-records", workspaceId] });
      invalidatePaymentStageViews(queryClient, workspaceId);
      if (order?.id) {
        void queryClient.invalidateQueries({ queryKey: ["order-payment-stages", workspaceId, "order", order.id] });
      }
      notifyOrderCalendarChanged(queryClient, workspaceId);
      toast.success(
        i18n.t(input.kind === "estimate" ? "orders.estimates.created" : "orders.toast.created"),
        { id: "create-order" },
      );
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("common.somethingWentWrong"), { id: "create-order" });
    },
  });
}
