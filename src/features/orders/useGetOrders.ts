import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  DEFAULT_ORDERS_PAGE_SIZE,
  getOrders,
  getOrdersAwaitingPayment,
  getOrdersPage,
  updateOrderStatus,
  updateOrderTaxInvoiceNumber,
  type OrdersListQuery,
  type OrdersPageResult,
} from "../../services/apiOrders";
import type { OrderStatus } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";

/** Unpaginated orders (dashboard, notifications, global search). */
export function useGetOrders(search = "", { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: orders, isLoading, error, refetch } = useQuery({
    queryKey: search ? ["orders", workspaceId, search] : ["orders", workspaceId],
    queryFn: () => getOrders(workspaceId, search),
    enabled: Boolean(workspaceId) && enabled,
  });

  return { orders: orders ?? [], isLoading, error, refetch };
}

export type OrdersListParams = Omit<OrdersListQuery, "today"> & { today: string };

/** Server-paginated orders list for the Orders page. */
export function useOrdersPage(params: OrdersListParams, { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const pageSize = params.pageSize ?? DEFAULT_ORDERS_PAGE_SIZE;
  const listKey = {
    search: params.search ?? "",
    status: params.status ?? "all",
    deadline: params.deadline ?? "all",
    employeeId: params.employeeId ?? "all",
    today: params.today,
    page: params.page,
    pageSize,
  } as const;

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["orders", workspaceId, "page", listKey],
    queryFn: () =>
      getOrdersPage(workspaceId, {
        search: listKey.search,
        status: listKey.status,
        deadline: listKey.deadline,
        employeeId: listKey.employeeId,
        today: listKey.today,
        page: listKey.page,
        pageSize: listKey.pageSize,
      }),
    enabled: Boolean(workspaceId) && enabled,
    placeholderData: (previous: OrdersPageResult | undefined) => previous,
  });

  return {
    orders: data?.orders ?? [],
    total: data?.total ?? 0,
    page: data?.page ?? params.page,
    pageSize: data?.pageSize ?? pageSize,
    pageCount: data?.pageCount ?? 1,
    isLoading,
    isFetching,
    error,
    refetch,
  };
}

/** Unpaid non-cancelled order total for the Orders header card. */
export function useOrdersAwaitingPayment({ enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["orders", workspaceId, "awaitingPayment"],
    queryFn: () => getOrdersAwaitingPayment(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
  });

  return {
    amount: data?.amount ?? 0,
    count: data?.count ?? 0,
    isLoading,
    error,
    refetch,
  };
}

export function useUpdateOrderTaxInvoiceNumber() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: ({ orderId, taxInvoiceNumber }: { orderId: string; taxInvoiceNumber: string }) =>
      updateOrderTaxInvoiceNumber(orderId, taxInvoiceNumber, workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("orders.taxInvoice.saveFailed"), { id: "update-tax-invoice-number" });
    },
  });
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  const { workspaceId } = useActiveWorkspaceId();

  return useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: OrderStatus }) => updateOrderStatus(orderId, status, workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
    },
    onError: (error) => {
      toast.error(error.message || i18n.t("orders.toast.statusUpdateFailed"), { id: "update-order-status" });
    },
  });
}
