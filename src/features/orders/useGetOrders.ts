import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  DEFAULT_ORDERS_PAGE_SIZE,
  getOrders,
  getOrderCountsByClient,
  getOrdersAwaitingPayment,
  getOrdersPage,
  updateOrderStatus,
  updateOrderTaxInvoiceNumber,
  type OrdersListQuery,
  type OrdersPageResult,
} from "../../services/apiOrders";
import type { Order, OrderStatus } from "../../lib/types";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGuardSubscriptionWrite } from "../workspaces/useWorkspaceSubscription";
import { useRealtimeHotQueryOptions } from "../realtime/useRealtimeHotQueryOptions";
import { patchOrderInLists } from "./orderCache";
import { getPayments } from "../../services/apiPayments";
import { paymentsQueryKey } from "../finance/usePayments";

/**
 * Ledger for the awaiting-payment sum, from the SAME cache entry as useGetPayments() (Orders page, order
 * card). Payment events / mutations invalidate it, so it is reused while valid and re-read only when stale —
 * an order edit no longer reloads the whole ledger (thousands of rows, several requests).
 */
function cachedLedger(queryClient: QueryClient, workspaceId: string | undefined) {
  return () =>
    queryClient.fetchQuery({
      queryKey: paymentsQueryKey(workspaceId, {}),
      queryFn: () => getPayments(workspaceId, {}),
      staleTime: 30_000,
    });
}
import { notifyOrderCalendarChanged } from "../calendar/pokeCalendarSync";

/** Patches taxInvoiceNumber on every cached orders list/page for this workspace. */
export function patchOrderTaxInvoiceInCache(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  orderId: string,
  taxInvoiceNumber: string,
) {
  if (!workspaceId) return;

  const patchOrder = (order: Order): Order =>
    order.id === orderId ? { ...order, taxInvoiceNumber } : order;

  queryClient.setQueriesData({ queryKey: ["orders", workspaceId] }, (data: unknown) => {
    if (Array.isArray(data)) {
      return (data as Order[]).map(patchOrder);
    }
    if (data && typeof data === "object" && Array.isArray((data as OrdersPageResult).orders)) {
      const page = data as OrdersPageResult;
      return { ...page, orders: page.orders.map(patchOrder) };
    }
    return data;
  });
}

/** Best cached Order for `orderId` across list and page queries (prefers one with a tax number). */
export function findCachedOrder(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  orderId: string,
): Order | undefined {
  if (!workspaceId) return undefined;

  let fallback: Order | undefined;
  for (const [, data] of queryClient.getQueriesData({ queryKey: ["orders", workspaceId] })) {
    const orders: Order[] | undefined = Array.isArray(data)
      ? (data as Order[])
      : data && typeof data === "object" && Array.isArray((data as OrdersPageResult).orders)
        ? (data as OrdersPageResult).orders
        : undefined;
    if (!orders) continue;
    const found = orders.find((order) => order.id === orderId);
    // Lightweight list rows carry no lines — never hand them to the order card as the full order.
    if (!found || found.linesOmitted) continue;
    if ((found.taxInvoiceNumber ?? "").trim()) return found;
    fallback ??= found;
  }
  return fallback;
}

/** Query key of the lightweight workspace order list (no lines) — shared by dashboard, employees, finance… */
export function orderHeadersQueryKey(workspaceId: string | undefined) {
  return ["orders", workspaceId, "headers"] as const;
}

/**
 * Unpaginated orders. `lines: false` → the lightweight list without lines (`linesOmitted`), which is what
 * counters / summaries need; the full list (lines included) is only for reports and invoices.
 */
export function useGetOrders(search = "", { enabled = true, lines = true }: { enabled?: boolean; lines?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const hot = useRealtimeHotQueryOptions();
  const { data: orders, isLoading, error, refetch } = useQuery({
    queryKey: !lines && !search ? orderHeadersQueryKey(workspaceId) : search ? ["orders", workspaceId, search] : ["orders", workspaceId],
    queryFn: () => getOrders(workspaceId, search, "order", { lines: lines || Boolean(search) }),
    enabled: Boolean(workspaceId) && enabled,
    ...hot,
  });

  return { orders: orders ?? [], isLoading, error, refetch };
}

/** Orders per client for the given clients (one list page) — `client_id` only, not the order list. */
export function useClientOrderCounts(clientIds: readonly string[], { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const ids = [...new Set(clientIds)].sort();
  const { data, isLoading } = useQuery({
    queryKey: ["orders", workspaceId, "client-counts", ids],
    queryFn: () => getOrderCountsByClient(workspaceId, ids),
    enabled: Boolean(workspaceId) && enabled && ids.length > 0,
    placeholderData: (previous) => previous,
  });
  return { counts: data ?? EMPTY_COUNTS, isLoading };
}

const EMPTY_COUNTS = new Map<string, number>();

/** One client's orders with lines (client card, search preview). */
export function useClientOrders(clientId: string | undefined, { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const { data: orders, isLoading, error, refetch } = useQuery({
    queryKey: ["orders", workspaceId, "client", clientId],
    queryFn: () => getOrders(workspaceId, "", "order", { clientId }),
    enabled: Boolean(workspaceId && clientId) && enabled,
  });
  return { orders: orders ?? [], isLoading, error, refetch };
}

export type OrdersListParams = Omit<OrdersListQuery, "today" | "onlyOrderIds"> & {
  today: string;
  /** Only orders with a remaining balance (ids from the awaiting-payment query, paged in the database). */
  awaitingPayment?: boolean;
};

export function ordersAwaitingPaymentQueryKey(workspaceId: string | undefined) {
  return ["orders", workspaceId, "awaitingPayment"] as const;
}

/** Server-paginated orders list for the Orders page. */
export function useOrdersPage(params: OrdersListParams, { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const pageSize = params.pageSize ?? DEFAULT_ORDERS_PAGE_SIZE;
  const listKey = {
    search: params.search ?? "",
    status: params.status ?? "all",
    customStatusId: params.customStatusId ?? "all",
    customStatusFallbackSystem: params.customStatusFallbackSystem ?? null,
    deadline: params.deadline ?? "all",
    employeeId: params.employeeId ?? "all",
    kind: params.kind ?? "order",
    today: params.today,
    page: params.page,
    pageSize,
    awaitingPayment: Boolean(params.awaitingPayment),
  } as const;
  const queryClient = useQueryClient();
  // Awaiting-payment ids come from the same cached query as the header card (one ledger read for both).
  const loadPage = async (key: typeof listKey) => {
    const onlyOrderIds = key.awaitingPayment
      ? (
          await queryClient.fetchQuery({
            queryKey: ordersAwaitingPaymentQueryKey(workspaceId),
            queryFn: () => getOrdersAwaitingPayment(workspaceId, cachedLedger(queryClient, workspaceId)),
          })
        ).orderIds
      : undefined;
    return getOrdersPage(workspaceId, {
      search: key.search,
      status: key.status,
      customStatusId: key.customStatusId,
      customStatusFallbackSystem: key.customStatusFallbackSystem,
      deadline: key.deadline,
      employeeId: key.employeeId,
      kind: key.kind,
      today: key.today,
      page: key.page,
      pageSize: key.pageSize,
      ...(onlyOrderIds ? { onlyOrderIds } : {}),
    });
  };

  const hot = useRealtimeHotQueryOptions();
  const { data, isLoading, isFetching, isPlaceholderData, error, refetch } = useQuery({
    queryKey: ["orders", workspaceId, "page", listKey],
    queryFn: () => loadPage(listKey),
    enabled: Boolean(workspaceId) && enabled,
    placeholderData: (previous: OrdersPageResult | undefined) => previous,
    ...hot,
  });

  // Next page in the background once this one is on screen → "Next" opens from cache, without waiting.
  const loadedPage = !isPlaceholderData ? data?.page : undefined;
  const loadedPageCount = data?.pageCount ?? 1;
  useEffect(() => {
    if (!workspaceId || !enabled || loadedPage == null || loadedPage >= loadedPageCount) return;
    const nextKey = { ...listKey, page: loadedPage + 1 };
    void queryClient.prefetchQuery({
      queryKey: ["orders", workspaceId, "page", nextKey],
      queryFn: () => loadPage(nextKey),
      staleTime: 30_000,
    });
    // listKey fields are primitives; the serialized key covers them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, workspaceId, enabled, loadedPage, loadedPageCount, JSON.stringify(listKey)]);

  return {
    orders: data?.orders ?? [],
    total: data?.total ?? 0,
    // While the next page loads, the previous page stays on screen (placeholder) — its `page` must not be
    // reported back: the Orders page would "clamp" to it and undo the click (page fetched twice / not switching).
    page: isPlaceholderData || !data ? params.page : data.page,
    pageSize: data?.pageSize ?? pageSize,
    pageCount: data?.pageCount ?? 1,
    isLoading,
    isFetching,
    isPlaceholderData,
    error,
    refetch,
  };
}

/** Unpaid non-cancelled order total for the Orders header card. */
export function useOrdersAwaitingPayment({ enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ordersAwaitingPaymentQueryKey(workspaceId),
    queryFn: () => getOrdersAwaitingPayment(workspaceId, cachedLedger(queryClient, workspaceId)),
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
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: ({ orderId, taxInvoiceNumber }: { orderId: string; taxInvoiceNumber: string }) => {
      guardWrite();
      return updateOrderTaxInvoiceNumber(orderId, taxInvoiceNumber, workspaceId);
    },
    onSuccess: (saved, { orderId }) => {
      // Keep list/page caches in sync immediately so reopen during placeholderData
      // refetch does not open a stale order with an empty tax invoice number.
      patchOrderTaxInvoiceInCache(queryClient, workspaceId, orderId, saved);
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
  const guardWrite = useGuardSubscriptionWrite();

  return useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: OrderStatus }) => {
      guardWrite();
      return updateOrderStatus(orderId, status, workspaceId);
    },
    onMutate: async ({ orderId, status }) => {
      await queryClient.cancelQueries({ queryKey: ["orders", workspaceId] });
      const previous = queryClient.getQueriesData({ queryKey: ["orders", workspaceId] });
      patchOrderInLists(queryClient, workspaceId, orderId, { status });
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error(error.message || i18n.t("orders.toast.statusUpdateFailed"), { id: "update-order-status" });
    },
    onSuccess: (result, { orderId }) => {
      const patch: Partial<Order> = {
        status: result.status,
        customStatusId: result.customStatusId,
        customStatus: result.customStatus,
      };
      if (Object.prototype.hasOwnProperty.call(result, "closedAt")) {
        patch.closedAt = result.closedAt ?? null;
      }
      patchOrderInLists(queryClient, workspaceId, orderId, patch);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["orders", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["order_events", workspaceId] });
      notifyOrderCalendarChanged(queryClient, workspaceId);
    },
  });
}
