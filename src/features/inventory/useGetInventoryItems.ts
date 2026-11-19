import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { InventoryItem, InventoryListFilter, InventorySort } from "../../lib/types";
import {
  getInventoryItems,
  getInventoryItemsByIds,
  getInventoryPage,
  getStockAttention,
  searchInventoryItems,
  type InventoryPageQuery,
  type InventorySearchInput,
} from "../../services/apiInventory";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useRealtimeHotQueryOptions } from "../realtime/useRealtimeHotQueryOptions";

export function useGetInventoryItems(
  search: string,
  filter: InventoryListFilter,
  sort: InventorySort,
  { enabled = true, supplier = "all" }: { enabled?: boolean; supplier?: string } = {},
) {
  const { workspaceId } = useActiveWorkspaceId();
  const hot = useRealtimeHotQueryOptions();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["inventory", workspaceId, search, filter, supplier, sort.field, sort.ascending],
    queryFn: () => getInventoryItems(search, filter, sort, workspaceId, supplier),
    enabled: Boolean(workspaceId) && enabled,
    ...hot,
  });

  return {
    items: data ?? [],
    isLoading,
    isError,
    error,
    refetch,
  };
}

/** One page of the Parts list, paginated in the database. Keeps the previous page on screen while loading. */
export function useInventoryPage(params: InventoryPageQuery) {
  const { workspaceId } = useActiveWorkspaceId();
  const hot = useRealtimeHotQueryOptions();
  return useQuery({
    queryKey: ["inventory", workspaceId, "page", params],
    queryFn: () => getInventoryPage(workspaceId, params),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
    ...hot,
  });
}

/** Out-of-stock / low-stock counts + the first `previewLimit` parts, computed in the database. */
export function useStockAttention(previewLimit = 10, { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const hot = useRealtimeHotQueryOptions();
  return useQuery({
    queryKey: ["inventory", workspaceId, "attention", previewLimit],
    queryFn: () => getStockAttention(workspaceId, previewLimit),
    enabled: Boolean(workspaceId) && enabled,
    ...hot,
  });
}

/** Picker search in the database (debounce the query in the caller). Keeps the previous result while typing. */
export function useInventorySearch(input: InventorySearchInput, { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["inventory", workspaceId, "search", input.query.trim().toLowerCase(), Boolean(input.inStockOnly), input.limit ?? 30],
    queryFn: () => searchInventoryItems(workspaceId, input),
    enabled: Boolean(workspaceId) && enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  return { items: data?.items ?? EMPTY_ITEMS, total: data?.total ?? 0, isLoading, isFetching, error };
}

/** Parts by id (the order's lines) — for prices / stock / names of what is already in the order. */
export function useInventoryItemsByIds(ids: readonly string[], { enabled = true }: { enabled?: boolean } = {}) {
  const { workspaceId } = useActiveWorkspaceId();
  const hot = useRealtimeHotQueryOptions();
  const sorted = [...new Set(ids.filter(Boolean))].sort();
  const { data, isLoading } = useQuery({
    queryKey: ["inventory", workspaceId, "by-ids", sorted],
    queryFn: () => getInventoryItemsByIds(workspaceId, sorted),
    enabled: Boolean(workspaceId) && enabled && sorted.length > 0,
    placeholderData: keepPreviousData,
    ...hot,
  });
  return { items: sorted.length === 0 ? EMPTY_ITEMS : (data ?? EMPTY_ITEMS), isLoading };
}

const EMPTY_ITEMS: InventoryItem[] = [];
