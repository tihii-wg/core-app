import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  createOrderPaymentStage,
  deleteOrderPaymentStage,
  getOrderPaymentStages,
  getOrderPaymentStagesForWorkspace,
  linkStageInvoice,
  replaceOrderPaymentStages,
  updateOrderPaymentStage,
  type OrderPaymentStageWrite,
} from "../../services/apiPaymentStages";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function orderPaymentStagesQueryKey(workspaceId: string | undefined, orderId: string | undefined) {
  return ["order-payment-stages", workspaceId, "order", orderId] as const;
}

export function workspacePaymentStagesQueryKey(workspaceId: string | undefined) {
  return ["order-payment-stages", workspaceId, "workspace"] as const;
}

/** Invalidate every stage query for the workspace (per-order and dashboard lists). */
export function invalidatePaymentStageViews(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string | undefined) {
  if (!workspaceId) return;
  void queryClient.invalidateQueries({ queryKey: ["order-payment-stages", workspaceId] });
}

export function useOrderPaymentStages(orderId: string | undefined) {
  const { workspaceId } = useActiveWorkspaceId();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: orderPaymentStagesQueryKey(workspaceId, orderId),
    queryFn: () => getOrderPaymentStages(orderId, workspaceId),
    enabled: Boolean(workspaceId && orderId),
  });
  return { stages: data ?? [], isLoading, isFetching, error, refetch };
}

/** Workspace-wide stages for the dashboard. */
export function useWorkspacePaymentStages(options: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: workspacePaymentStagesQueryKey(workspaceId),
    queryFn: () => getOrderPaymentStagesForWorkspace(workspaceId),
    enabled: Boolean(workspaceId) && options.enabled !== false,
  });
  return { stages: data ?? [], isLoading, isFetching, error, refetch };
}

function useStageMutationHandlers() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  return {
    workspaceId,
    guardWrite,
    onSuccess: () => invalidatePaymentStageViews(queryClient, workspaceId),
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("finance.paymentStages.errors.saveFailed"));
    },
  };
}

export function useReplaceOrderPaymentStages(orderId: string | undefined) {
  const { workspaceId, guardWrite, onSuccess, onError } = useStageMutationHandlers();
  return useMutation({
    mutationFn: (stages: readonly OrderPaymentStageWrite[]) => {
      guardWrite();
      if (!orderId) throw new Error(i18n.t("finance.paymentStages.errors.orderNotFound"));
      return replaceOrderPaymentStages(orderId, workspaceId, stages);
    },
    onSuccess,
    onError,
  });
}

export function useCreateOrderPaymentStage(orderId: string | undefined) {
  const { workspaceId, guardWrite, onSuccess, onError } = useStageMutationHandlers();
  return useMutation({
    mutationFn: (stage: OrderPaymentStageWrite) => {
      guardWrite();
      if (!orderId) throw new Error(i18n.t("finance.paymentStages.errors.orderNotFound"));
      return createOrderPaymentStage(orderId, workspaceId, stage);
    },
    onSuccess,
    onError,
  });
}

export function useUpdateOrderPaymentStage() {
  const { workspaceId, guardWrite, onSuccess, onError } = useStageMutationHandlers();
  return useMutation({
    mutationFn: ({ stageId, patch }: { stageId: string; patch: Partial<OrderPaymentStageWrite> }) => {
      guardWrite();
      return updateOrderPaymentStage(stageId, workspaceId, patch);
    },
    onSuccess,
    onError,
  });
}

export function useDeleteOrderPaymentStage() {
  const { workspaceId, guardWrite, onSuccess, onError } = useStageMutationHandlers();
  return useMutation({
    mutationFn: (stageId: string) => {
      guardWrite();
      return deleteOrderPaymentStage(stageId, workspaceId);
    },
    onSuccess,
    onError,
  });
}

export function useLinkStageInvoice() {
  const queryClient = useQueryClient();
  const { workspaceId, guardWrite, onSuccess, onError } = useStageMutationHandlers();
  return useMutation({
    mutationFn: ({ stageId, invoiceId }: { stageId: string; invoiceId: string | null }) => {
      guardWrite();
      return linkStageInvoice(stageId, invoiceId, workspaceId);
    },
    onSuccess: () => {
      onSuccess();
      if (workspaceId) void queryClient.invalidateQueries({ queryKey: ["invoices", workspaceId] });
    },
    onError,
  });
}
