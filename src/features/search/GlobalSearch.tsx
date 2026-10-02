import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "../../ui/Input";
import { InventoryStatusBadge, OrderStatusBadge } from "../../ui/StatusBadge";
import type { Client, InventoryItem, Order } from "../../lib/types";
import { MIN_SEARCH_LENGTH, useGlobalSearch } from "./useGlobalSearch";
import OrderDetailPanel from "../orders/OrderDetailPanel";
import { useOrderDetails } from "../orders/useOrderDetails";
import { useGetOrders } from "../orders/useGetOrders";
import ClientDetailPanel from "../clients/ClientDetailPanel";
import ClientTypeBadge from "../clients/ClientTypeBadge";
import { clientOrderSummaries } from "../clients/clientOrders";
import InventoryDetailPanel from "../inventory/InventoryDetailPanel";
import { EditInventoryItemDialog } from "../inventory/EditInventoryItemDialog";
import { DeleteInventoryItemDialog } from "../inventory/DeleteInventoryItemDialog";
import { useGetInventoryItem } from "../inventory/useGetInventoryItem";

const RESULTS_PER_GROUP = 5;
const listboxId = "global-search-results";

type SearchResult = { type: "order"; id: string; order: Order } | { type: "client"; id: string; client: Client } | { type: "inventory"; id: string; item: InventoryItem };

type ResultGroup = { key: string; label: string; total: number; isError: boolean; results: SearchResult[] };

function details(values: (string | null | undefined)[]) {
  return values.filter(Boolean).join(" · ");
}

function ResultContent({ result }: { result: SearchResult }) {
  let title: ReactNode;
  let badge: ReactNode;
  let subtitle: string;

  if (result.type === "order") {
    const { order } = result;
    title = <span className="font-medium text-[#1973e1]">{order.orderNumber}</span>;
    badge = <OrderStatusBadge status={order.status} />;
    subtitle = details([order.clientName, order.device, order.carNumber, order.vin]);
  } else if (result.type === "client") {
    const { client } = result;
    title = <span className="font-medium text-[#282e33]">{client.name}</span>;
    badge = <ClientTypeBadge clientType={client.client_type} />;
    subtitle = details([client.phone, client.email, client.contact_person, client.tax_id]);
  } else {
    const { item } = result;
    title = <span className="font-medium text-[#282e33]">{item.name}</span>;
    badge = <InventoryStatusBadge status={item.stockStatus} />;
    subtitle = details([item.sku, item.category, `${item.quantity} ${item.unit}`.trim()]);
  }

  return (
    <>
      <span className="flex items-center justify-between gap-2">
        {title} {badge}
      </span>
      {subtitle && <span className="block truncate text-xs text-[#939699]">{subtitle}</span>}
    </>
  );
}

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const search = useGlobalSearch(query);

  const orderDetails = useOrderDetails();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientPanelOpen, setClientPanelOpen] = useState(false);
  const { orders: clientOrders } = useGetOrders("", { enabled: Boolean(selectedClient) });
  const [inventoryDetailId, setInventoryDetailId] = useState<string | null>(null);
  const [editInventoryId, setEditInventoryId] = useState<string | null>(null);
  const [inventoryToDelete, setInventoryToDelete] = useState<InventoryItem | null>(null);
  const inventoryDetail = useGetInventoryItem(inventoryDetailId);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  const groups: ResultGroup[] = [
    {
      key: "orders",
      label: "Orders",
      total: search.orders.results.length,
      isError: search.orders.isError,
      results: search.orders.results.slice(0, RESULTS_PER_GROUP).map((order) => ({ type: "order", id: order.id, order })),
    },
    {
      key: "clients",
      label: "Clients",
      total: search.clients.results.length,
      isError: search.clients.isError,
      results: search.clients.results.slice(0, RESULTS_PER_GROUP).map((client) => ({ type: "client", id: client.id, client })),
    },
    {
      key: "inventory",
      label: "Inventory",
      total: search.inventory.results.length,
      isError: search.inventory.isError,
      results: search.inventory.results.slice(0, RESULTS_PER_GROUP).map((item) => ({ type: "inventory", id: item.id, item })),
    },
  ];
  const visibleGroups = groups.filter((group) => group.isError || group.results.length > 0);
  const flatResults = visibleGroups.flatMap((group) => group.results);
  const active = activeIndex < flatResults.length ? activeIndex : -1;

  const typed = query.trim();
  const showDropdown = open && typed.length > 0;
  const showResults = showDropdown && typed.length >= MIN_SEARCH_LENGTH && !search.isSearching && visibleGroups.length > 0;

  function selectResult(result: SearchResult) {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
    if (result.type === "order") {
      orderDetails.openOrder(result.order);
    } else if (result.type === "client") {
      setSelectedClient(result.client);
      setClientPanelOpen(true);
    } else {
      setInventoryDetailId(result.item.id);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!showResults && event.key !== "ArrowDown") return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(Math.min(active + 1, flatResults.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(active - 1, 0));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      selectResult(flatResults[active]);
    }
  }

  let message: string | null = null;
  if (showDropdown && !showResults) {
    if (typed.length < MIN_SEARCH_LENGTH) message = `Type at least ${MIN_SEARCH_LENGTH} characters to search.`;
    else if (search.isSearching) message = "Searching...";
    else message = `No results for "${search.term}"`;
  }

  let optionIndex = -1;

  return (
    <div ref={containerRef} className="hidden md:block relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#939699]" />
      <Input
        type="text"
        role="combobox"
        aria-label="Search orders, clients and inventory"
        aria-autocomplete="list"
        aria-expanded={showResults}
        aria-controls={listboxId}
        aria-activedescendant={showResults && active >= 0 ? `${listboxId}-${active}` : undefined}
        placeholder="Search..."
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="w-64 h-9 pl-9 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-2  focus:ring-[#1973e1]/20 text-sm"
      />

      {showDropdown && (
        <div className="absolute right-0 top-full z-50 mt-2 w-96 max-h-[70vh] overflow-y-auto rounded-md border border-[#eeeeef] bg-white shadow-lg">
          {message && (
            <p role="status" className="px-4 py-6 text-center text-sm text-[#939699]">
              {message}
            </p>
          )}
          {showResults && (
            <div id={listboxId} role="listbox" aria-label="Search results" className="py-2">
              {visibleGroups.map((group) => (
                <div key={group.key} role="group" aria-labelledby={`${listboxId}-${group.key}`} className="py-1">
                  <div id={`${listboxId}-${group.key}`} className="flex items-center justify-between px-4 py-1 text-xs font-medium uppercase tracking-wide text-[#939699]">
                    <span>{group.label}</span>
                    {group.total > group.results.length && (
                      <span className="normal-case tracking-normal">
                        {` ${group.results.length} of ${group.total}`}
                      </span>
                    )}
                  </div>
                  {group.isError && <p className="px-4 py-2 text-sm text-[#f41f20]">Could not load {group.label.toLowerCase()}.</p>}
                  {group.results.map((result) => {
                    optionIndex += 1;
                    const index = optionIndex;
                    return (
                      <div
                        key={`${result.type}-${result.id}`}
                        id={`${listboxId}-${index}`}
                        role="option"
                        aria-selected={index === active}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => selectResult(result)}
                        className={`cursor-pointer px-4 py-2 text-sm ${index === active ? "bg-[#edf4fd]" : ""}`}
                      >
                        <ResultContent result={result} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {orderDetails.panelProps.selectedOrder && <OrderDetailPanel {...orderDetails.panelProps} />}

      {selectedClient && (
        <ClientDetailPanel
          selectedClient={selectedClient}
          detailPanelOpen={clientPanelOpen}
          setDetailPanelOpen={setClientPanelOpen}
          onClientUpdated={setSelectedClient}
          getClientOrders={(clientId) => clientOrderSummaries(clientOrders, clientId)}
        />
      )}

      <InventoryDetailPanel
        item={inventoryDetail.item}
        open={Boolean(inventoryDetailId)}
        isLoading={inventoryDetail.isLoading}
        isError={inventoryDetail.isError}
        onOpenChange={(isOpen) => {
          if (!isOpen) setInventoryDetailId(null);
        }}
        onRetry={() => inventoryDetail.refetch()}
        onEdit={() => {
          setEditInventoryId(inventoryDetailId);
          setInventoryDetailId(null);
        }}
        onDelete={() => {
          if (!inventoryDetail.item) return;
          setInventoryToDelete(inventoryDetail.item);
          setInventoryDetailId(null);
        }}
      />
      {editInventoryId && <EditInventoryItemDialog itemId={editInventoryId} onClose={() => setEditInventoryId(null)} />}
      <DeleteInventoryItemDialog item={inventoryToDelete} onClose={() => setInventoryToDelete(null)} />
    </div>
  );
}
