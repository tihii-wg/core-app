import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  deleteFullyVoidedPayment,
  getPayments,
  PaymentsUnavailableError,
  recordPayment,
  recordPaymentVoid,
  recordRefund,
  type RecordVoidInput,
} from "../../services/apiPayments";
import type { PaymentListFilters, RecordPaymentInput, RecordRefundInput } from "./paymentTypes";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";

export function paymentsQueryKey(workspaceId: string | undefined, filters: PaymentListFilters = {}) {
  return ["payments", workspaceId, filters] as const;
}

export function useGetPayments(filters: PaymentListFilters = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: paymentsQueryKey(workspaceId, filters),
    queryFn: () => getPayments(workspaceId, filters),
    enabled: Boolean(workspaceId),
    retry: (failureCount, queryError) => !(queryError instanceof PaymentsUnavailableError) && failureCount < 3,
  });

  return {
    payments: data ?? [],
    isLoading,
    isFetching,
    error,
    refetch,
    isUnavailable: error instanceof PaymentsUnavailableError,
  };
}

/** Invalidate payment-dependent views after a successful ledger insert. */
export function invalidatePaymentViews(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string | undefined) {
  if (!workspaceId) return;
  // Prefix match: all ["payments", workspaceId, …] filter variants.
  void queryClient.invalidateQueries({ queryKey: ["payments", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["invoices", workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ["expenses", workspaceId] });
  // A payment with `account_id` moves the cash account balance (ledger rows live in finance_transactions).
  void queryClient.invalidateQueries({ queryKey: ["finance-accounts", workspaceId] });
  // Dashboard financials re-read orders/invoices/payments via the keys above.
  // Reports use the same workspace-scoped orders + payments queries.
}

export function useRecordPayment() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const toastId = "record-payment";

  return useMutation({
    mutationFn: (input: RecordPaymentInput) => {
      guardWrite();
      return recordPayment(input, workspaceId);
    },
    onMutate: () => {
      toast.loading(i18n.t("finance.payments.toast.recording"), { id: toastId });
    },
    onSuccess: () => {
      invalidatePaymentViews(queryClient, workspaceId);
      toast.success(i18n.t("finance.payments.toast.recorded"), { id: toastId });
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("finance.payments.errors.saveFailed"), { id: toastId });
    },
  });
}

export function useRecordRefund() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const toastId = "record-refund";

  return useMutation({
    mutationFn: (input: RecordRefundInput) => {
      guardWrite();
      return recordRefund(input, workspaceId);
    },
    onMutate: () => {
      toast.loading(i18n.t("finance.payments.toast.refunding"), { id: toastId });
    },
    onSuccess: () => {
      invalidatePaymentViews(queryClient, workspaceId);
      toast.success(i18n.t("finance.payments.toast.refunded"), { id: toastId });
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("finance.payments.errors.saveFailed"), { id: toastId });
    },
  });
}

export function useRecordPaymentVoid() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const toastId = "record-payment-void";

  return useMutation({
    mutationFn: (input: RecordVoidInput) => {
      guardWrite();
      return recordPaymentVoid(input, workspaceId);
    },
    onMutate: () => {
      toast.loading(i18n.t("finance.payments.void.toast.recording"), { id: toastId });
    },
    onSuccess: () => {
      invalidatePaymentViews(queryClient, workspaceId);
      toast.success(i18n.t("finance.payments.void.toast.recorded"), { id: toastId });
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("finance.payments.errors.saveFailed"), { id: toastId });
    },
  });
}

export function useDeleteFullyVoidedPayment() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();
  const guardWrite = useGuardSubscriptionWrite();
  const toastId = "delete-fully-voided-payment";

  return useMutation({
    mutationFn: (paymentId: string) => {
      guardWrite();
      return deleteFullyVoidedPayment(paymentId, workspaceId);
    },
    onMutate: () => {
      toast.loading(i18n.t("finance.payments.void.toast.deleting"), { id: toastId });
    },
    onSuccess: () => {
      invalidatePaymentViews(queryClient, workspaceId);
      toast.success(i18n.t("finance.payments.void.toast.deleted"), { id: toastId });
    },
    onError: (error: Error) => {
      toast.error(error.message || i18n.t("finance.payments.void.errors.deleteFailed"), { id: toastId });
    },
  });
}
