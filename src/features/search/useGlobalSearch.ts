import { useDebounce } from "../../hooks/useDebounce";
import type { InventorySort } from "../../lib/types";
import { useGetClients } from "../clients/useGetClients";
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
import { useGetOrders } from "../orders/useGetOrders";

export const MIN_SEARCH_LENGTH = 2;

const inventorySort: InventorySort = { field: "name", ascending: true };

export function useGlobalSearch(query: string) {
  const typed = query.trim();
  const term = useDebounce(typed, 300);
  const enabled = term.length >= MIN_SEARCH_LENGTH;

  const orders = useGetOrders(term, { enabled });
  const clients = useGetClients(term, "all", { enabled });
  const inventory = useGetInventoryItems(term, "all", inventorySort, { enabled });

  // A disabled query can still return the cached unfiltered list for the empty term.
  return {
    term,
    isSearching: typed !== term || (enabled && (orders.isLoading || clients.isLoading || inventory.isLoading)),
    orders: { results: enabled ? orders.orders : [], isError: enabled && Boolean(orders.error) },
    clients: { results: enabled ? (clients.clients ?? []) : [], isError: enabled && Boolean(clients.error) },
    inventory: { results: enabled ? inventory.items : [], isError: enabled && inventory.isError },
  };
}
