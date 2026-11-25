import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Trans, useTranslation } from "react-i18next";
import CreateServiceDialog from "../services/CreateServiceDialog";
import { AddInventoryItemDialog } from "../inventory/AddInventoryItemDialog";
import { QuickGoodsReceiptDialog } from "../inventory/QuickGoodsReceiptDialog";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import toast from "react-hot-toast";
import type { InventoryItem, Order, OrderMaterial, OrderService, Service } from "../../lib/types";
import { cn } from "../../lib/utils";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import { serviceCategoryLabel } from "../industries/industryWorkflow";
import { useInventorySearch } from "../inventory/useGetInventoryItems";
import { useDebounce } from "../../hooks/useDebounce";
import { useServiceSearch } from "../services/useGetServices";
import { catalogServiceToOrderLine } from "../services/orderServiceLine";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageServices } from "../workspaces/workspaceRoles";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import {
  ORDER_ADD_LINES_SEARCH_GROUP_LIMIT,
  filterInventoryForAddLinesSearch,
  filterServicesForAddLinesSearch,
} from "./orderAddLinesSearchFilter";
import { usesWorksAndMaterialsTabLabel } from "./orderDetailTabs";
import { useAppendOrderLines } from "./useAppendOrderLines";
import { catalogItemToOrderMaterial } from "../inventory/orderMaterialLine";
import { useGetWarehouses } from "../warehouses/useGetWarehouses";
import { useGetWarehouseStock } from "../warehouses/useGetWarehouseStock";
import { isEstimateOrder } from "./orderEstimates";
import { issuableWarehouses, warehouseStockOf } from "./issueWarehouse";
import { useOrderMaterialFreeformSupport } from "./useOrderMaterialFreeformSupport";
import { useWorkspaceWarrantyDefaults } from "./useWorkspaceWarrantyDefaults";

export type OrderAddLinesMaterialPrefill =
  | { kind: "catalog"; item: InventoryItem }
  | { kind: "one_time" | "customer"; name: string };

type OrderAddLinesSearchProps = {
  order: Order;
  industrySlug: string | null | undefined;
  allowServices: boolean;
  allowMaterials: boolean;
  onServiceAdded: (order: Order, meta?: { catalogServiceId: string }) => void;
  /** Catalog material added straight from the search (1 unit from a warehouse that has it). */
  onMaterialAdded?: (order: Order) => void;
  /** Optimistic rows for a material being added; returns a revert used when the save fails. */
  onMaterialPending?: (drafts: OrderMaterial[]) => () => void;
  /** Catalog service already on the order: the parent bumps that line's quantity (no duplicate line). */
  onHighlightServiceLine: (serviceId: string) => void;
  /** Catalog item already on the order: the parent bumps that line by `by`. Returns false when there is no such line. */
  onIncrementMaterialLine?: (inventoryItemId: string, by?: number) => boolean;
  onOpenMaterial: (prefill: OrderAddLinesMaterialPrefill) => void;
  /** Lets the parent restore focus to the search after a line-price / performer editor closes. */
  focusRegistration?: (focus: () => void) => void;
};

type FlatOption =
  | { type: "service"; service: Service }
  | { type: "item"; item: InventoryItem }
  | { type: "show-more-services" }
  | { type: "show-more-items" }
  | { type: "create-service" }
  | { type: "create-item" }
  | { type: "one-time" }
  | { type: "customer" };

/**
 * Unified search at the top of the order items tab: pick a catalog service (append immediately) or an
 * inventory item / freeform material (opens the existing material dialog). Dropdown is portaled so the
 * tab scroll container cannot clip it.
 */
export default function OrderAddLinesSearch({
  order,
  industrySlug,
  allowServices,
  allowMaterials,
  onServiceAdded,
  onHighlightServiceLine,
  onIncrementMaterialLine,
  onMaterialAdded,
  onMaterialPending,
  onOpenMaterial,
  focusRegistration,
}: OrderAddLinesSearchProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const works = usesWorksAndMaterialsTabLabel(industrySlug);
  const listId = useId();
  const canCreateServices = canManageServices(useActiveWorkspaceRole());
  const warrantyDefaults = useWorkspaceWarrantyDefaults();
  const { supported: freeformSupported } = useOrderMaterialFreeformSupport();
  const { mutateAsync: appendLines } = useAppendOrderLines();
  const { data: warehouseRows = [] } = useGetWarehouses();
  const { data: warehouseStock = [] } = useGetWarehouseStock();
  // Picks are queued and saved one after another, so several services / items can be added in a row
  // without waiting (and without responses overwriting each other out of order).
  const addQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const latestOrderRef = useRef(order);
  latestOrderRef.current = order;

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const suppressOpenOnFocusRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [servicesExpanded, setServicesExpanded] = useState(false);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const [pendingServiceId, setPendingServiceId] = useState<string | null>(null);
  /** Name prefilled into the full "new service" dialog; null = dialog closed. */
  const [createServiceName, setCreateServiceName] = useState<string | null>(null);
  /** Name prefilled into the Parts page "new part" dialog; null = dialog closed. */
  const [createItemName, setCreateItemName] = useState<string | null>(null);
  /** Part just created here → goods receipt (оприходование) dialog. */
  const [receiveItem, setReceiveItem] = useState<InventoryItem | null>(null);
  const { canWrite: canWriteWorkspace } = useWorkspaceSubscription();
  /** Catalog item picked from the search: asks how many before it is added (Enter adds, Esc cancels). */
  const [qtyPrompt, setQtyPrompt] = useState<InventoryItem | null>(null);
  const [qtyText, setQtyText] = useState("1");
  const [qtyError, setQtyError] = useState<string | null>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number } | null>(null);

  const debouncedQuery = useDebounce(query, 200);
  // Services are searched in the database too (active, every word in name / category).
  const serviceSearch = useServiceSearch(
    { query: debouncedQuery, limit: servicesExpanded ? 200 : ORDER_ADD_LINES_SEARCH_GROUP_LIMIT },
    { enabled: allowServices && open },
  );
  const activeServices = useMemo(() => (allowServices ? serviceSearch.services : []), [allowServices, serviceSearch.services]);
  // Parts are searched in the database (in stock, every word matched), not filtered from the whole catalog.
  const itemSearch = useInventorySearch(
    { query: debouncedQuery, inStockOnly: true, limit: itemsExpanded ? 200 : ORDER_ADD_LINES_SEARCH_GROUP_LIMIT },
    { enabled: allowMaterials && open },
  );
  const activeItems = useMemo(() => (allowMaterials ? itemSearch.items : []), [allowMaterials, itemSearch.items]);

  const matchedServices = useMemo(
    () => filterServicesForAddLinesSearch(activeServices, query),
    [activeServices, query],
  );
  const matchedItems = useMemo(
    () => filterInventoryForAddLinesSearch(activeItems, query),
    [activeItems, query],
  );

  const serviceGroup = {
    visible: matchedServices,
    hiddenCount: servicesExpanded || debouncedQuery !== query ? 0 : Math.max(0, serviceSearch.total - matchedServices.length),
  };
  const itemGroup = {
    visible: matchedItems,
    hiddenCount: itemsExpanded || debouncedQuery !== query ? 0 : Math.max(0, itemSearch.total - matchedItems.length),
  };

  const trimmedQuery = query.trim();
  const hasMatches = matchedServices.length > 0 || matchedItems.length > 0;
  const showNoMatchActions = open && trimmedQuery.length > 0 && !hasMatches;
  const exactServiceName = activeServices.some(
    (service) => service.service_name.trim().toLowerCase() === trimmedQuery.toLowerCase(),
  );
  const showCreateService = showNoMatchActions && allowServices && canCreateServices && !exactServiceName;
  const exactItemName = activeItems.some((item) => item.name.trim().toLowerCase() === trimmedQuery.toLowerCase());
  const showCreateItem = showNoMatchActions && allowMaterials && canWriteWorkspace && !exactItemName;
  const showFreeform = showNoMatchActions && allowMaterials && freeformSupported;

  const flatOptions = useMemo(() => {
    const options: FlatOption[] = [];
    if (allowServices) {
      for (const service of serviceGroup.visible) options.push({ type: "service", service });
      if (serviceGroup.hiddenCount > 0) options.push({ type: "show-more-services" });
    }
    if (allowMaterials) {
      for (const item of itemGroup.visible) options.push({ type: "item", item });
      if (itemGroup.hiddenCount > 0) options.push({ type: "show-more-items" });
    }
    if (showCreateService) options.push({ type: "create-service" });
    if (showCreateItem) options.push({ type: "create-item" });
    if (showFreeform) {
      options.push({ type: "one-time" });
      options.push({ type: "customer" });
    }
    return options;
  }, [
    allowMaterials,
    allowServices,
    itemGroup.hiddenCount,
    itemGroup.visible,
    serviceGroup.hiddenCount,
    serviceGroup.visible,
    showCreateService,
    showCreateItem,
    showFreeform,
  ]);

  const firstItemIndex = flatOptions.findIndex((option) => option.type === "item");
  const firstNoMatchIndex = flatOptions.findIndex(
    (option) =>
      option.type === "create-service" ||
      option.type === "create-item" ||
      option.type === "one-time" ||
      option.type === "customer",
  );

  /** Inventory item to pre-highlight once it shows up in the list (a part just created here). */
  const highlightItemIdRef = useRef<string | null>(null);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open, servicesExpanded, itemsExpanded, showNoMatchActions]);

  // Runs after the reset above: once the refetched catalog contains the new part, highlight it for Enter.
  useEffect(() => {
    const wantedId = highlightItemIdRef.current;
    if (!wantedId) return;
    const index = flatOptions.findIndex((option) => option.type === "item" && option.item.id === wantedId);
    if (index < 0) return;
    highlightItemIdRef.current = null;
    setActiveIndex(index);
  }, [flatOptions, query, open]);

  useEffect(() => {
    if (!open) {
      setMenuBox(null);
      return;
    }

    function updatePosition() {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Inside a modal dialog/sheet the menu must live INSIDE it: Radix makes everything outside the
      // modal non-interactive, so a menu portaled to <body> could be seen but not clicked.
      const host = el.closest<HTMLElement>('[role="dialog"]');
      const hostRect = host?.getBoundingClientRect();
      setMenuBox({
        top: rect.bottom + 4 - (hostRect?.top ?? 0),
        left: rect.left - (hostRect?.left ?? 0),
        width: rect.width,
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, query, flatOptions.length]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function clearQueryState() {
    setQuery("");
    setServicesExpanded(false);
    setItemsExpanded(false);
  }

  useEffect(() => {
    focusRegistration?.(() => {
      // Programmatic focus (after a line editor closes) must not pop the result list over the lines.
      suppressOpenOnFocusRef.current = true;
      inputRef.current?.focus();
      suppressOpenOnFocusRef.current = false;
    });
  }, [focusRegistration]);

  /** After a pick: clear the text, close the list and KEEP the focus here for the next search. */
  function readyForNextPick() {
    clearQueryState();
    setOpen(false);
    suppressOpenOnFocusRef.current = true;
    inputRef.current?.focus();
    suppressOpenOnFocusRef.current = false;
  }

  function enqueue(task: () => Promise<void>) {
    const next = addQueueRef.current.then(task, task);
    addQueueRef.current = next.catch(() => undefined);
    return next;
  }

  function addServiceLine(draft: OrderService, pendingId: string, catalogServiceId: string) {
    readyForNextPick();
    void enqueue(async () => {
      // A queued pick of a service that an earlier pick in the queue already added: bump its quantity instead.
      if (latestOrderRef.current.services.some((line) => line.serviceId === catalogServiceId)) {
        onHighlightServiceLine(catalogServiceId);
        return;
      }
      setPendingServiceId(pendingId);
      try {
        const updated = await appendLines({ orderId: order.id, kind: "services", drafts: [draft] });
        latestOrderRef.current = updated;
        onServiceAdded(updated, { catalogServiceId });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
      } finally {
        setPendingServiceId(null);
      }
    });
  }

  function handleSelectService(service: Service) {
    const existing = order.services.find((line) => line.serviceId === service.id);
    if (existing) {
      // No duplicate line: the parent bumps the existing line's quantity and explains it in a toast.
      readyForNextPick();
      onHighlightServiceLine(service.id);
      return;
    }
    const draft = catalogServiceToOrderLine(
      service,
      warrantyDefaults,
      order.vehicleMileageUnitSnapshot ?? "km",
    );
    addServiceLine(draft, service.id, service.id);
  }

  /** Issuable warehouse to take one unit from: the first (default) one that has the item in stock. */
  function quickIssueWarehouseId(itemId: string): string | null {
    for (const warehouse of issuableWarehouses(warehouseRows)) {
      if (warehouseStockOf(warehouseStock, warehouse.id, itemId) > 0) return warehouse.id;
    }
    return null;
  }

  /** Issuable warehouse that can give `quantity` (the first one with enough stock), else null. */
  function issueWarehouseFor(itemId: string, quantity: number): string | null {
    for (const warehouse of issuableWarehouses(warehouseRows)) {
      if (warehouseStockOf(warehouseStock, warehouse.id, itemId) >= quantity) return warehouse.id;
    }
    return null;
  }

  /** Most that one warehouse can give (a line is issued from one warehouse). */
  function maxIssuable(itemId: string): number {
    return issuableWarehouses(warehouseRows).reduce(
      (max, warehouse) => Math.max(max, warehouseStockOf(warehouseStock, warehouse.id, itemId)),
      0,
    );
  }

  function handleSelectItem(item: InventoryItem) {
    const onOrder = (order.materials ?? []).some((line) => line.id && line.inventoryItemId === item.id);
    // No warehouse with stock known here (or no quick-add wiring): the full material dialog, as before.
    if (!onOrder && !isEstimateOrder(order) && (!onMaterialAdded || !quickIssueWarehouseId(item.id))) {
      setOpen(false);
      setQuery("");
      onOpenMaterial({ kind: "catalog", item });
      return;
    }
    setOpen(false);
    setQtyPrompt(item);
    setQtyText("1");
    setQtyError(null);
    window.setTimeout(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }, 0);
  }

  function cancelQtyPrompt() {
    setQtyPrompt(null);
    setQtyError(null);
    readyForNextPick();
  }

  function confirmQtyPrompt() {
    const item = qtyPrompt;
    if (!item) return;
    const quantity = Number(qtyText.trim().replace(",", "."));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setQtyError(t("orders.addLinesSearch.qtyInvalid"));
      return;
    }
    const estimate = isEstimateOrder(order);
    const onOrder = (latestOrderRef.current.materials ?? []).some((line) => line.id && line.inventoryItemId === item.id);
    if (onOrder) {
      setQtyPrompt(null);
      readyForNextPick();
      onIncrementMaterialLine?.(item.id, quantity);
      return;
    }
    const warehouseId = estimate
      ? quickIssueWarehouseId(item.id) ?? issuableWarehouses(warehouseRows)[0]?.id ?? undefined
      : issueWarehouseFor(item.id, quantity);
    if (!estimate && !warehouseId) {
      setQtyError(
        t("orders.addLinesSearch.qtyNotEnough", {
          count: maxIssuable(item.id),
          unit: item.unit?.trim() || t("orders.addLinesSearch.unitFallback"),
        }),
      );
      return;
    }
    setQtyPrompt(null);
    addCatalogMaterial(item, quantity, warehouseId ?? undefined);
  }

  /** Saves a catalog material line (queued), keeping the focus in the search for the next pick. */
  function addCatalogMaterial(item: InventoryItem, quantity: number, warehouseId: string | undefined) {
    const draft = catalogItemToOrderMaterial(
      item,
      quantity,
      warehouseId,
      warrantyDefaults,
      order.vehicleMileageUnitSnapshot ?? "km",
    );
    readyForNextPick();
    void enqueue(async () => {
      // Picked twice quickly: the first pick's line exists now → bump it instead of a second line.
      if (
        (latestOrderRef.current.materials ?? []).some((line) => line.id && line.inventoryItemId === item.id) &&
        onIncrementMaterialLine?.(item.id, quantity)
      ) {
        return;
      }
      const revert = onMaterialPending?.([draft]) ?? (() => undefined);
      try {
        const updated = await appendLines({ orderId: order.id, kind: "materials", drafts: [draft], orderKind: order.kind });
        latestOrderRef.current = updated;
        onMaterialAdded?.(updated);
      } catch (error) {
        revert();
        toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
      }
    });
  }

  function openCreateServiceDialog() {
    if (!showCreateService || !trimmedQuery) return;
    setOpen(false);
    setCreateServiceName(trimmedQuery);
  }

  function openCreateItemDialog() {
    if (!trimmedQuery) return;
    setOpen(false);
    setCreateItemName(trimmedQuery);
  }

  /** After the part is created (and received), put it into the search so Enter adds it to the order. */
  function showItemInSearch(item: InventoryItem) {
    highlightItemIdRef.current = item.id;
    setQuery(item.name);
    setServicesExpanded(false);
    setItemsExpanded(false);
    setOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleServiceCreated(service: Service) {
    setQuery("");
    // Same as picking it from the catalog: the new service becomes an order line straight away.
    handleSelectService(service);
  }

  function activateOption(option: FlatOption) {
    switch (option.type) {
      case "service":
        void handleSelectService(option.service);
        break;
      case "item":
        handleSelectItem(option.item);
        break;
      case "show-more-services":
        setServicesExpanded(true);
        break;
      case "show-more-items":
        setItemsExpanded(true);
        break;
      case "create-service":
        openCreateServiceDialog();
        break;
      case "create-item":
        openCreateItemDialog();
        break;
      case "one-time":
        setOpen(false);
        onOpenMaterial({ kind: "one_time", name: trimmedQuery });
        setQuery("");
        break;
      case "customer":
        setOpen(false);
        onOpenMaterial({ kind: "customer", name: trimmedQuery });
        setQuery("");
        break;
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (!open) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (flatOptions.length === 0) return;
      setActiveIndex((index) => (index + 1) % flatOptions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (flatOptions.length === 0) return;
      setActiveIndex((index) => (index - 1 + flatOptions.length) % flatOptions.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = flatOptions[activeIndex];
      if (option) activateOption(option);
    }
  }

  const placeholder = t(
    works ? "orders.addLinesSearch.placeholderWorks" : "orders.addLinesSearch.placeholder",
  );

  const menu =
    open && menuBox
      ? createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            data-testid="order-add-lines-search-menu"
            className={cn(
              "z-[80] max-h-80 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md",
              rootRef.current?.closest('[role="dialog"]') ? "absolute" : "fixed",
            )}
            style={{ top: menuBox.top, left: menuBox.left, width: menuBox.width }}
          >
            {allowServices && serviceGroup.visible.length > 0 ? (
              <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t(works ? "orders.addLinesSearch.worksGroup" : "orders.addLinesSearch.servicesGroup")}
              </p>
            ) : null}

            {flatOptions.map((option, index) => {
              const selected = activeIndex === index;
              const rowClass = cn(
                "flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-muted",
                selected && "bg-muted",
              );

              if (option.type === "service") {
                const busy = pendingServiceId === option.service.id;
                const category = serviceCategoryLabel(option.service.category, industrySlug);
                return (
                  <button
                    key={`service-${option.service.id}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-option-index={index}
                    data-testid={`order-add-lines-service-${option.service.id}`}
                    // Keep the caret in the search while clicking an option.
                    onMouseDown={(event) => event.preventDefault()}
                    className={rowClass}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => void handleSelectService(option.service)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {option.service.service_name}
                      </span>
                      {category ? (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{category}</span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-sm font-medium tabular-nums text-foreground">
                      {busy ? <Spinner className="size-4" /> : null}
                      {formatMoney(option.service.service_price ?? 0)}
                    </span>
                  </button>
                );
              }

              if (option.type === "show-more-services") {
                return (
                  <button
                    key="show-more-services"
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-option-index={index}
                    className={cn(rowClass, "items-center text-sm text-primary")}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => setServicesExpanded(true)}
                  >
                    {t("orders.addLinesSearch.showMore", { count: serviceGroup.hiddenCount })}
                  </button>
                );
              }

              if (option.type === "item") {
                const stock = Number(option.item.quantity) || 0;
                const stockLabel =
                  stock <= 0
                    ? t("orders.addLinesSearch.outOfStock")
                    : t("orders.addLinesSearch.inStock", {
                        count: stock,
                        unit: option.item.unit || t("orders.addLinesSearch.unitFallback"),
                      });
                return (
                  <div key={`item-${option.item.id}`}>
                    {index === firstItemIndex ? (
                      <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {t(works ? "orders.addLinesSearch.materialsGroup" : "orders.addLinesSearch.productsGroup")}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-option-index={index}
                      data-testid={`order-add-lines-item-${option.item.id}`}
                      onMouseDown={(event) => event.preventDefault()}
                      className={rowClass}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => handleSelectItem(option.item)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">{option.item.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {[option.item.category, option.item.sku].filter(Boolean).join(" · ")}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 block truncate text-xs",
                            stock <= 0 ? "text-destructive/80" : "text-muted-foreground",
                          )}
                        >
                          {stockLabel}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                        {formatMoney(option.item.sellingPrice ?? 0)}
                      </span>
                    </button>
                  </div>
                );
              }

              if (option.type === "show-more-items") {
                return (
                  <button
                    key="show-more-items"
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-option-index={index}
                    className={cn(rowClass, "items-center text-sm text-primary")}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => setItemsExpanded(true)}
                  >
                    {t("orders.addLinesSearch.showMore", { count: itemGroup.hiddenCount })}
                  </button>
                );
              }

              if (option.type === "create-service") {
                return (
                  <div key="create-service" className="space-y-2 border-t border-border px-3 py-3">
                    {index === firstNoMatchIndex ? (
                      <p className="text-sm text-muted-foreground">{t("orders.addLinesSearch.noResults")}</p>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-option-index={index}
                      data-testid="order-add-lines-create-service"
                      className={cn("w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted", selected && "bg-muted")}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={openCreateServiceDialog}
                    >
                      <Trans
                        i18nKey={works ? "orders.addLinesSearch.createWork" : "orders.addLinesSearch.createService"}
                        values={{ name: trimmedQuery }}
                        components={{ strong: <strong /> }}
                      />
                    </button>
                  </div>
                );
              }

              if (option.type === "create-item") {
                return (
                  <div key="create-item" className={cn("px-3 py-1", index === firstNoMatchIndex && "border-t border-border pt-3")}>
                    {index === firstNoMatchIndex ? (
                      <p className="pb-2 text-sm text-muted-foreground">{t("orders.addLinesSearch.noResults")}</p>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-option-index={index}
                      data-testid="order-add-lines-create-item"
                      className={cn("w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted", selected && "bg-muted")}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={openCreateItemDialog}
                    >
                      <Trans
                        i18nKey={works ? "orders.addLinesSearch.createMaterial" : "orders.addLinesSearch.createItem"}
                        values={{ name: trimmedQuery }}
                        components={{ strong: <strong /> }}
                      />
                    </button>
                  </div>
                );
              }

              if (option.type === "one-time" || option.type === "customer") {
                return (
                  <div
                    key={option.type}
                    className={cn(index === firstNoMatchIndex && "space-y-1 border-t border-border px-3 py-3")}
                  >
                    {index === firstNoMatchIndex ? (
                      <p className="mb-1 text-sm text-muted-foreground">{t("orders.addLinesSearch.noResults")}</p>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-option-index={index}
                      data-testid={
                        option.type === "one-time" ? "order-add-lines-one-time" : "order-add-lines-customer"
                      }
                      className={cn(
                        "w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
                        index !== firstNoMatchIndex && "px-3",
                        selected && "bg-muted",
                      )}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => activateOption(option)}
                    >
                      <Trans
                        i18nKey={
                          option.type === "one-time"
                            ? "orders.addLinesSearch.addOneTime"
                            : "orders.addLinesSearch.addCustomer"
                        }
                        values={{ name: trimmedQuery }}
                        components={{ strong: <strong /> }}
                      />
                    </button>
                  </div>
                );
              }

              return null;
            })}

            {open && !hasMatches && flatOptions.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">{t("orders.addLinesSearch.noResults")}</p>
            ) : null}
          </div>,
          rootRef.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative w-full" data-testid="order-add-lines-search">
      <Input
        ref={inputRef}
        value={query}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder}
        className="min-h-11 w-full"
        onFocus={() => {
          if (!suppressOpenOnFocusRef.current) setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setServicesExpanded(false);
          setItemsExpanded(false);
        }}
        onKeyDown={onKeyDown}
      />
      {qtyPrompt ? (
        <div
          className="mt-2 space-y-1.5 rounded-md border border-primary/40 bg-primary/5 p-2.5"
          data-testid="order-add-lines-qty-prompt"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={qtyPrompt.name}>
              {qtyPrompt.name}
            </span>
            <Input
              ref={qtyInputRef}
              value={qtyText}
              inputMode="decimal"
              aria-label={t("orders.addLinesSearch.qtyLabel")}
              className="h-9 w-24 text-right tabular-nums"
              onChange={(event) => {
                setQtyText(event.target.value);
                setQtyError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  confirmQtyPrompt();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelQtyPrompt();
                }
              }}
            />
            <span className="text-sm text-muted-foreground">
              {qtyPrompt.unit?.trim() || t("orders.addLinesSearch.unitFallback")}
            </span>
            <Button type="button" size="sm" onClick={confirmQtyPrompt}>
              {t("orders.addLinesSearch.qtyAdd")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={cancelQtyPrompt}>
              {t("common.cancel")}
            </Button>
          </div>
          {qtyError ? (
            <p className="text-xs text-destructive">{qtyError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {isEstimateOrder(order)
                ? t("orders.addLinesSearch.qtyHint")
                : t("orders.addLinesSearch.qtyHintStock", {
                    count: maxIssuable(qtyPrompt.id),
                    unit: qtyPrompt.unit?.trim() || t("orders.addLinesSearch.unitFallback"),
                  })}
            </p>
          )}
        </div>
      ) : null}
      {menu}
      <CreateServiceDialog
        open={createServiceName !== null}
        onOpenChange={(next) => {
          if (!next) setCreateServiceName(null);
        }}
        initialName={createServiceName ?? undefined}
        onCreated={handleServiceCreated}
      />
      <AddInventoryItemDialog
        open={createItemName !== null}
        onOpenChange={(next) => {
          if (!next) setCreateItemName(null);
        }}
        initialName={createItemName ?? ""}
        onCreated={(item) => {
          setCreateItemName(null);
          // Same procedure as on the Parts page: create → receive the stock (оприходование).
          setReceiveItem(item);
        }}
      />
      <QuickGoodsReceiptDialog
        open={receiveItem !== null}
        onOpenChange={(next) => {
          if (next || !receiveItem) return;
          const created = receiveItem;
          setReceiveItem(null);
          // Received or skipped: the new part is in the catalog now — show it in the search.
          showItemInSearch(created);
        }}
        item={receiveItem}
        defaultQuantity={1}
      />
    </div>
  );
}
