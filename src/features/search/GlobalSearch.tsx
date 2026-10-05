import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
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

type ResultGroup = { key: string; label: string; errorMessage: string; total: number; isError: boolean; results: SearchResult[] };

function details(values: (string | null | undefined)[]) {
  return values.filter(Boolean).join(" · ");
}

function ResultContent({ result }: { result: SearchResult }) {
  let title: ReactNode;
  let badge: ReactNode;
  let subtitle: string;

  if (result.type === "order") {
    const { order } = result;
    title = <span className="font-medium text-primary">{order.orderNumber}</span>;
    badge = <OrderStatusBadge status={order.status} />;
    subtitle = details([order.clientName, order.device, order.carNumber, order.vin]);
  } else if (result.type === "client") {
    const { client } = result;
    title = <span className="font-medium text-foreground">{client.name}</span>;
    badge = <ClientTypeBadge clientType={client.client_type} />;
    subtitle = details([client.phone, client.email, client.contact_person, client.tax_id]);
  } else {
    const { item } = result;
    title = <span className="font-medium text-foreground">{item.name}</span>;
    badge = <InventoryStatusBadge status={item.stockStatus} />;
    subtitle = details([item.sku, item.category, `${item.quantity} ${item.unit}`.trim()]);
  }

  return (
    <>
      <span className="flex min-w-0 items-center justify-between gap-2 [&>span:first-child]:truncate">
        {title} {badge}
      </span>
      {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
    </>
  );
}

export default function GlobalSearch() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useGlobalSearch(query);

  useEffect(() => {
    const focusOnShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", focusOnShortcut);
    return () => document.removeEventListener("keydown", focusOnShortcut);
  }, []);

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
      label: t("search.groups.orders"),
      errorMessage: t("search.errors.orders"),
      total: search.orders.results.length,
      isError: search.orders.isError,
      results: search.orders.results.slice(0, RESULTS_PER_GROUP).map((order) => ({ type: "order", id: order.id, order })),
    },
    {
      key: "clients",
      label: t("search.groups.clients"),
      errorMessage: t("search.errors.clients"),
      total: search.clients.results.length,
      isError: search.clients.isError,
      results: search.clients.results.slice(0, RESULTS_PER_GROUP).map((client) => ({ type: "client", id: client.id, client })),
    },
    {
      key: "inventory",
      label: t("search.groups.inventory"),
      errorMessage: t("search.errors.inventory"),
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
    if (typed.length < MIN_SEARCH_LENGTH) message = t("search.minLength", { count: MIN_SEARCH_LENGTH });
    else if (search.isSearching) message = t("search.searching");
    else message = t("search.noResults", { term: search.term });
  }

  let optionIndex = -1;

  return (
    <div ref={containerRef} className="relative hidden md:block">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
      <Input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={t("search.inputLabel")}
        aria-autocomplete="list"
        aria-expanded={showResults}
        aria-controls={listboxId}
        aria-activedescendant={showResults && active >= 0 ? `${listboxId}-${active}` : undefined}
        placeholder={t("common.searchPlaceholder")}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="h-9 w-44 border-transparent bg-muted pr-12 pl-9 text-sm shadow-none hover:border-border focus:bg-card md:w-56 lg:w-52 xl:w-72"
      />
      <kbd aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-card px-1.5 py-px font-sans text-[10px] font-medium text-subtle-foreground lg:block">
        ⌘K
      </kbd>

      {showDropdown && (
        <div className="absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-[26rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg animate-in fade-in-0 slide-in-from-top-1 duration-150">
          {message && (
            <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">
              {message}
            </p>
          )}
          {showResults && (
            <div id={listboxId} role="listbox" aria-label={t("search.resultsLabel")} className="p-1.5">
              {visibleGroups.map((group) => (
                <div key={group.key} role="group" aria-labelledby={`${listboxId}-${group.key}`} className="py-1">
                  <div id={`${listboxId}-${group.key}`} className="flex items-center justify-between px-2.5 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-subtle-foreground">
                    <span>{group.label}</span>
                    {group.total > group.results.length && (
                      <span className="normal-case tracking-normal">
                        {` ${t("search.groupCount", { shown: group.results.length, total: group.total })}`}
                      </span>
                    )}
                  </div>
                  {group.isError && <p className="px-4 py-2 text-sm text-destructive">{group.errorMessage}</p>}
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
                        className={`cursor-pointer rounded-md px-2.5 py-2 text-sm ${index === active ? "bg-muted" : ""}`}
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
