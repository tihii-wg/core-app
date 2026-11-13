import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardList, EllipsisVertical, MapPin, Pencil, Phone, Plus, Trash2, Users, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { Button } from "../../ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/DropdownMenu";
import { Input } from "../../ui/Input";
import { EntityStatusBadge, OrderStatusBadge } from "../../ui/StatusBadge";
import { Skeleton } from "../../ui/Skeleton";
import { Tabs, TabsList, TabsTrigger } from "../../ui/Tabs";
import ClientTypeBadge from "./ClientTypeBadge";
import type { Client, Order, OrderStatus } from "../../lib/types";
import { canUseOrderEstimates } from "../orders/orderEstimates";
import { isOrderEstimatesSupported } from "../../services/apiOrders";
import { useClientEstimates } from "./useClientEstimates";
import {
  industryClientCopy,
  industryOrderStatusLabel,
  ORDER_STATUSES,
  shouldShowOrderAssetValue,
} from "../industries/industryWorkflow";
import { industryProfile } from "../industries/industryProfile";
import { industrySupportsClientVehicles } from "../industries/industryCapabilities";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { ClientVehiclesSection } from "../vehicles/ClientVehiclesSection";
import { useGetClientVehicles } from "../vehicles/useGetClientVehicles";
import EditClientForm from "./EditClientForm";
import { ClientExtrasSection } from "./ClientExtrasSection";
import ClientSettlementDialog from "./ClientSettlementDialog";
import { DeleteClientDialog } from "./DeleteClientDialog";
import { MergeClientsDialog } from "./MergeClientsDialog";
import { ClientAssetsTab } from "./ClientAssetsTab";
import { ClientDocumentsTab } from "./ClientDocumentsTab";
import { ClientPaymentsTab } from "./ClientPaymentsTab";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { clientOrderHistoryLine, clientOrderSummaries, type ClientOrderSummary } from "./clientOrders";
import { useClientOrdersCount } from "./useClientOrdersCount";
import { filterClientCardSearch, highlightMatch, type ClientSearchableOrder } from "./clientSearch";
import {
  applyClientAssetFilter,
  deriveClientDevices,
  deriveClientSites,
  type ClientAssetFilter,
} from "./clientAssets";
import {
  isClientDetailTab,
  peekClientDetailTab,
  readClientDetailTabOnOpen,
  writeClientDetailTab,
  type ClientDetailTab,
} from "./clientDetailTabs";
import { useGetPayments } from "../finance/usePayments";
import { useDebounce } from "../../hooks/useDebounce";
import { cn } from "../../lib/utils";
import { displayCustomFieldValue } from "../../services/apiCustomFields";
import { useOrderCustomFieldValuesForOrders, useOrderFieldConfig } from "../orders/useOrderFieldConfig";

type ClientDetailPanelProps = {
  selectedClient: Client | null;
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
  onClientUpdated: (client: Client) => void;
  onClientDeleted?: (clientId: string) => void;
  getClientOrders: (clientId: string) => ClientOrderSummary[];
  /** Full workspace orders (hydrated) — used for card search and assets; summaries stay for display. */
  workspaceOrders?: Order[];
  ordersLoading?: boolean;
  ordersError?: boolean;
  onOpenOrder?: (orderId: string) => void;
  /** Second arg is set when creating from a specific vehicle row on this card. */
  onCreateOrder?: (client: Client, vehicleId?: string) => void;
  /** Create estimate (same form as order) from the client card. */
  onCreateEstimate?: (client: Client, vehicleId?: string) => void;
};

/** Without search, the Orders tab shows up to this many rows (same cap as an active search). */
const ORDER_LIST_LIMIT = 50;

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  return <span dangerouslySetInnerHTML={{ __html: highlightMatch(text, query) }} />;
}

function summaryToSearchable(order: ClientOrderSummary): ClientSearchableOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    customStatus: order.customStatus ?? null,
    device: order.device,
    carNumber: order.carNumber,
    vin: order.vin,
    deviceSerial: "",
    deviceImei: "",
    siteAddress: "",
    productDimensions: "",
    description: "",
    assignedEmployeeName: "",
    totalPrice: order.totalPrice,
    createdAt: order.createdAt,
    deadline: "",
    isPaid: order.isPaid,
    services: order.service
      ? [{ serviceId: "", serviceName: order.service, price: 0, quantity: 1 }]
      : [],
    materials: [],
    vehicleId: null,
  };
}

export default function ClientDetailPanel({
  selectedClient,
  detailPanelOpen,
  setDetailPanelOpen,
  onClientUpdated,
  onClientDeleted,
  getClientOrders,
  workspaceOrders,
  ordersLoading = false,
  ordersError = false,
  onOpenOrder,
  onCreateOrder,
  onCreateEstimate,
}: ClientDetailPanelProps) {
  const { t } = useTranslation();
  const { workflow } = useIndustryWorkflow();
  const clientCopy = industryClientCopy(workflow);
  const showVehicles = industrySupportsClientVehicles(workflow);
  const profile = industryProfile(workflow.slug);
  const { formatMoney } = useWorkspaceMoney();
  const { canWrite: canMutateClients } = useWorkspaceSubscription();
  const [isEditing, setIsEditing] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState(selectedClient?.id);
  const [cardSearch, setCardSearch] = useState("");
  const [assetFilter, setAssetFilter] = useState<ClientAssetFilter | null>(null);
  const debouncedCardSearch = useDebounce(cardSearch, 200);

  // Session-backed tab: survives client switches and sheet reopen; first open in a session starts on general.
  const [storedTab, setStoredTab] = useState<ClientDetailTab>(() =>
    detailPanelOpen ? readClientDetailTabOnOpen() : peekClientDetailTab(),
  );
  const [prevDetailPanelOpen, setPrevDetailPanelOpen] = useState(detailPanelOpen);
  if (detailPanelOpen !== prevDetailPanelOpen) {
    setPrevDetailPanelOpen(detailPanelOpen);
    if (detailPanelOpen) setStoredTab(readClientDetailTabOnOpen());
  }

  // Assets tab exists only for industries with client assets (vehicles need the vehicles capability).
  const assetKind = profile.assetKind === "vehicle" && !showVehicles ? "none" : profile.assetKind;
  const hasAssetsTab = assetKind !== "none";
  const activeTab: ClientDetailTab = storedTab === "assets" && !hasAssetsTab ? "general" : storedTab;

  function selectTab(tab: ClientDetailTab) {
    setStoredTab(tab);
    writeClientDetailTab(tab);
  }

  const { vehicles } = useGetClientVehicles(showVehicles && detailPanelOpen ? selectedClient?.id : null);
  const { payments, isLoading: paymentsLoading } = useGetPayments();
  const industryBlocks = profile.orderFieldBlocks;

  if (selectedClient?.id !== editingClientId) {
    setEditingClientId(selectedClient?.id);
    setIsEditing(false);
    setDeleteOpen(false);
    setMergeOpen(false);
    setCardSearch("");
    setAssetFilter(null);
  }

  useEffect(() => {
    if (!detailPanelOpen) {
      setCardSearch("");
      setAssetFilter(null);
    }
  }, [detailPanelOpen]);

  function handleOpenChange(open: boolean) {
    setDetailPanelOpen(open);
    if (!open) {
      setIsEditing(false);
      setDeleteOpen(false);
      setMergeOpen(false);
      setCardSearch("");
      setAssetFilter(null);
    }
  }

  const phone = selectedClient?.phone?.trim() ?? "";
  const address = selectedClient?.address?.trim() ?? "";
  const notes = selectedClient?.notes?.trim() ?? "";
  const contactPerson = selectedClient?.contact_person?.trim() ?? "";
  const taxId = selectedClient?.tax_id?.trim() ?? "";
  const isOrganization = selectedClient?.client_type === "organization";
  const hasContact =
    Boolean(phone) ||
    Boolean(address) ||
    (isOrganization && Boolean(contactPerson)) ||
    (isOrganization && Boolean(taxId));

  const clientOrders = selectedClient ? getClientOrders(selectedClient.id) : [];
  const { count: remoteOrdersCount } = useClientOrdersCount(selectedClient?.id, {
    enabled: Boolean(selectedClient) && detailPanelOpen,
  });
  /** Total for this client — exact head count when ready, else full client-scoped list length (not filtered/sliced). */
  const totalOrdersCount =
    selectedClient == null ? null : remoteOrdersCount ?? clientOrders.length;

  const searchableOrders: ClientSearchableOrder[] = useMemo(() => {
    if (!selectedClient) return [];
    if (workspaceOrders && workspaceOrders.length > 0) {
      return workspaceOrders.filter((order) => order.clientId === selectedClient.id);
    }
    return clientOrders.map(summaryToSearchable);
  }, [selectedClient, workspaceOrders, clientOrders]);

  // Assets for device / site industries are derived from the client's orders (no extra tables).
  const devices = useMemo(
    () => (assetKind === "device" ? deriveClientDevices(searchableOrders) : []),
    [assetKind, searchableOrders],
  );
  const sites = useMemo(
    () => (assetKind === "site" || assetKind === "project" ? deriveClientSites(searchableOrders) : []),
    [assetKind, searchableOrders],
  );

  const statusLabels = useMemo(() => {
    const labels: Partial<Record<OrderStatus, string>> = {};
    for (const status of ORDER_STATUSES) {
      labels[status] = industryOrderStatusLabel(workflow, status);
    }
    return labels;
  }, [workflow]);

  const { fields: orderFieldConfig } = useOrderFieldConfig();
  const searchableOrderIds = useMemo(() => searchableOrders.map((order) => order.id), [searchableOrders]);
  const { data: customValuesBatch = [] } = useOrderCustomFieldValuesForOrders(searchableOrderIds);
  const customFieldTextsByOrderId = useMemo(() => {
    const defs = orderFieldConfig.filter((field) => field.isCustom && field.visible && field.definitionId);
    const byOrder: Record<string, string[]> = {};
    for (const row of customValuesBatch) {
      const def = defs.find((field) => field.definitionId === row.definitionId);
      if (!def) continue;
      const text = displayCustomFieldValue(def.type, row.value, def.options);
      if (!text) continue;
      (byOrder[row.entityId] ??= []).push(text);
    }
    return byOrder;
  }, [customValuesBatch, orderFieldConfig]);

  const searchResult = useMemo(
    () =>
      filterClientCardSearch({
        query: debouncedCardSearch,
        orders: searchableOrders,
        vehicles: vehicles.map((vehicle) => ({
          id: vehicle.id,
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
          licensePlate: vehicle.licensePlate,
          vin: vehicle.vin,
        })),
        payments,
        statusLabels,
        paymentLabels: {
          unpaid: t("status.payment.unpaid"),
          partial: t("status.payment.partial"),
          paid: t("status.payment.paid"),
        },
        industryBlocks,
        customFieldTextsByOrderId,
      }),
    [debouncedCardSearch, searchableOrders, vehicles, payments, statusLabels, t, industryBlocks, customFieldTextsByOrderId],
  );

  const filteredOrders = useMemo(() => {
    const bySearch = debouncedCardSearch.trim()
      ? (() => {
          const allowed = new Set(searchResult.orderIds);
          return clientOrders.filter((order) => allowed.has(order.id));
        })()
      : clientOrders;
    return applyClientAssetFilter(bySearch, assetFilter);
  }, [clientOrders, debouncedCardSearch, searchResult.orderIds, assetFilter]);

  const searchActive = Boolean(debouncedCardSearch.trim());
  // Vehicles only join the Orders tab results while searching (the full list lives on the Assets tab).
  const showSearchVehicles = showVehicles && searchActive && !assetFilter;
  const visibleVehicleIds = showSearchVehicles ? searchResult.vehicleIds : undefined;
  const searchEmpty = searchActive && filteredOrders.length === 0 && (visibleVehicleIds?.length ?? 0) === 0;

  const tabs: { value: ClientDetailTab; label: string }[] = [
    { value: "general", label: t("clients.detail.tabs.general") },
    ...(hasAssetsTab
      ? [
          {
            value: "assets" as const,
            label:
              assetKind === "vehicle"
                ? `${t("clients.detail.tabs.vehicles")} (${vehicles.length})`
                : assetKind === "device"
                  ? `${t("clients.detail.tabs.devices")} (${devices.length})`
                  : assetKind === "site"
                    ? `${t("clients.detail.tabs.sites")} (${sites.length})`
                    : `${t("clients.detail.tabs.objects")} (${sites.length})`,
          },
        ]
      : []),
    {
      value: "orders",
      label:
        totalOrdersCount == null
          ? t("clients.detail.tabs.orders")
          : t("clients.detail.orderHistoryWithCount", { count: totalOrdersCount }),
    },
    { value: "documents", label: t("clients.detail.tabs.documents") },
    { value: "payments", label: t("clients.detail.tabs.payments") },
  ];

  function handleSelectAsset(filter: ClientAssetFilter) {
    setAssetFilter(filter);
    setCardSearch("");
    selectTab("orders");
  }

  const canCreateOrder = Boolean(onCreateOrder) && canMutateClients;
  const estimatesEnabled = canUseOrderEstimates(isOrderEstimatesSupported());
  const canCreateEstimate = Boolean(onCreateEstimate) && canMutateClients && estimatesEnabled;
  const { estimates: clientEstimateOrders, isLoading: estimatesLoading } = useClientEstimates(
    selectedClient?.id,
    { enabled: detailPanelOpen && estimatesEnabled && activeTab === "orders" },
  );
  const estimateSummaries = useMemo(
    () => (selectedClient ? clientOrderSummaries(clientEstimateOrders, selectedClient.id, "estimate") : []),
    [clientEstimateOrders, selectedClient],
  );
  const showMoreMenu = canMutateClients;

  return (
    <Sheet open={detailPanelOpen} onOpenChange={handleOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-2xl">
        <SheetHeader className="shrink-0 pr-24">
          <SheetTitle>
            <span className="inline-flex min-w-0 flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
              {selectedClient?.name}
              {selectedClient && <ClientTypeBadge clientType={selectedClient.client_type} />}
            </span>
          </SheetTitle>
          {phone ? (
            <a
              href={`tel:${phone}`}
              data-testid="client-detail-header-phone"
              className="inline-flex min-h-8 w-fit items-center gap-1.5 rounded-md text-sm font-normal text-foreground tabular-nums outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/35"
            >
              <Phone className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
              {phone}
            </a>
          ) : null}
          {selectedClient && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              aria-label={t("common.edit")}
              title={clientCopy.detailEditTitle}
              className="absolute top-3.5 right-12 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35"
            >
              <Pencil className="size-4" />
            </button>
          )}
          <SheetDescription className="sr-only">{clientCopy.detailSrDescription}</SheetDescription>
        </SheetHeader>

        {selectedClient && !isEditing ? (
          <div className="shrink-0 border-b border-border px-5 py-1.5" data-testid="client-detail-tabs">
            <Tabs value={activeTab} onValueChange={(value) => isClientDetailTab(value) && selectTab(value)}>
              <TabsList className="h-auto w-full flex-nowrap justify-start overflow-x-auto">
                {tabs.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value} className="h-11 min-h-11 shrink-0">
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        ) : null}

        {selectedClient ? (
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="client-detail-scroll">
            {isEditing ? (
              <div className="px-5 py-5">
                <EditClientForm
                  key={selectedClient.id}
                  client={selectedClient}
                  onCancel={() => setIsEditing(false)}
                  onUpdated={(client) => {
                    onClientUpdated(client);
                    setIsEditing(false);
                    setDetailPanelOpen(false);
                  }}
                />
              </div>
            ) : (
              <div className="space-y-6 px-5 py-5">
                {activeTab === "general" ? (
                  <>
                    {hasContact ? (
                      <div className="space-y-3">
                        <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">{t("clients.detail.contactInformation")}</h3>
                        <div className="space-y-2 text-sm">
                          {phone ? (
                            <div className="flex items-center gap-2">
                              <Phone className="size-4 shrink-0 text-subtle-foreground" />
                              <a href={`tel:${phone}`} className="text-foreground tabular-nums">
                                {phone}
                              </a>
                            </div>
                          ) : null}
                          {isOrganization && contactPerson ? (
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">{t("clients.detail.contact")}</span>
                              <span className="text-foreground">{contactPerson}</span>
                            </div>
                          ) : null}
                          {isOrganization && taxId ? (
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">{t("clients.detail.taxId")}</span>
                              <span className="text-foreground">{taxId}</span>
                            </div>
                          ) : null}
                          {address ? (
                            <div className="flex items-start gap-2">
                              <MapPin className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
                              <span className="[overflow-wrap:anywhere] text-foreground">{address}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-lg border border-border bg-muted/50 p-4">
                      <p className="text-xs font-medium text-muted-foreground">{t("clients.detail.currentBalance")}</p>
                      <p className={`mt-1 truncate text-2xl font-semibold tracking-tight tabular-nums ${selectedClient.balance > 0 ? "text-success" : "text-foreground"}`}>
                        {formatMoney(selectedClient.balance)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{t("clients.detail.balanceHint")}</p>
                    </div>

                    <ClientExtrasSection clientId={selectedClient.id} />

                    {notes ? (
                      <div>
                        <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">{t("clients.detail.notes")}</h3>
                        <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere] text-foreground">{notes}</p>
                      </div>
                    ) : null}

                    {selectedClient.created_at ? (
                      <div className="text-xs text-muted-foreground">
                        <p>{clientCopy.clientSince(selectedClient.created_at.split("T")[0] ?? "")}</p>
                      </div>
                    ) : null}
                  </>
                ) : null}

                {activeTab === "assets" && assetKind !== "none" ? (
                  <ClientAssetsTab
                    client={selectedClient}
                    assetKind={assetKind}
                    devices={devices}
                    sites={sites}
                    onOpenOrder={onOpenOrder}
                    onCreateOrder={canMutateClients ? onCreateOrder : undefined}
                    onSelectAsset={handleSelectAsset}
                  />
                ) : null}

                {activeTab === "orders" ? (
                  <div className="space-y-3">
                    <Input
                      value={cardSearch}
                      onChange={(event) => setCardSearch(event.target.value)}
                      placeholder={t("clients.cardSearch.placeholder")}
                      aria-label={t("clients.cardSearch.placeholder")}
                      className="w-full min-w-0"
                      type="search"
                    />

                    {assetFilter ? (
                      <div
                        className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/50 py-1 pr-1 pl-3 text-xs"
                        data-testid="client-asset-filter-chip"
                      >
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-foreground">
                          {t("clients.detail.assets.filteredBy", { name: assetFilter.label })}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("clients.detail.assets.clearFilter")}
                          onClick={() => setAssetFilter(null)}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ) : null}

                    {searchActive && !searchEmpty ? (
                      <p className="text-xs text-muted-foreground" data-testid="client-card-search-count">
                        {showVehicles
                          ? t("clients.cardSearch.foundWithVehicles", {
                              orders: filteredOrders.length,
                              vehicles: visibleVehicleIds?.length ?? 0,
                            })
                          : t("clients.cardSearch.found", { orders: filteredOrders.length })}
                      </p>
                    ) : null}

                    {searchEmpty ? (
                      <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
                        <p className="text-[13px] font-medium text-foreground">{t("clients.cardSearch.empty")}</p>
                        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setCardSearch("")}>
                          {t("clients.cardSearch.reset")}
                        </Button>
                      </div>
                    ) : null}

                    {!searchEmpty && showSearchVehicles && (visibleVehicleIds?.length ?? 0) > 0 ? (
                      <ClientVehiclesSection
                        clientId={selectedClient.id}
                        onOpenOrder={onOpenOrder}
                        onCreateOrder={
                          canMutateClients && onCreateOrder
                            ? (vehicleId) => onCreateOrder(selectedClient, vehicleId)
                            : undefined
                        }
                        visibleVehicleIds={visibleVehicleIds}
                        highlightQuery={searchResult.normalizedQuery}
                      />
                    ) : null}

                    {!searchEmpty ? (
                      <div>
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">
                            {totalOrdersCount == null
                              ? t("clients.detail.orderHistory")
                              : t("clients.detail.orderHistoryWithCount", { count: totalOrdersCount })}
                          </h3>
                          <div className="flex flex-wrap items-center gap-2">
                            {canCreateOrder ? (
                              <Button type="button" variant="outline" size="sm" onClick={() => onCreateOrder?.(selectedClient)}>
                                <Plus />
                                {t("clients.detail.createOrder")}
                              </Button>
                            ) : null}
                            {canCreateEstimate ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onCreateEstimate?.(selectedClient)}
                              >
                                <Plus />
                                {t("clients.detail.createEstimate")}
                              </Button>
                            ) : null}
                          </div>
                        </div>

                        {ordersLoading ? (
                          <div className="space-y-2">
                            <Skeleton className="h-12 w-full" />
                            <Skeleton className="h-12 w-full" />
                          </div>
                        ) : ordersError ? (
                          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
                            <p className="text-[13px] font-medium text-foreground">{t("clients.detail.ordersLoadFailed")}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{t("clients.detail.ordersLoadFailedHint")}</p>
                          </div>
                        ) : filteredOrders.length === 0 ? (
                          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
                            <ClipboardList aria-hidden="true" className="mx-auto size-5 text-subtle-foreground" />
                            <p className="mt-2 text-[13px] font-medium text-foreground">{t("clients.detail.noOrders")}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{t("clients.detail.noOrdersHint")}</p>
                          </div>
                        ) : (
                          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                            {filteredOrders.slice(0, ORDER_LIST_LIMIT).map((order) => {
                              const historyLine = clientOrderHistoryLine(
                                order,
                                shouldShowOrderAssetValue(workflow.orderFields.device, order.device, "device"),
                                shouldShowOrderAssetValue(workflow.orderFields.carNumber, order.carNumber, "carNumber"),
                                shouldShowOrderAssetValue(workflow.orderFields.vin, order.vin, "vin"),
                              );
                              const content = (
                                <>
                                  <span className="min-w-0 flex-1">
                                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                      <span className="text-sm font-medium text-primary tabular-nums">
                                        <HighlightedText text={order.orderNumber} query={searchResult.normalizedQuery} />
                                      </span>
                                      <OrderStatusBadge status={order.status} customStatus={order.customStatus} />
                                    </span>
                                    {order.createdAt ? (
                                      <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">{order.createdAt}</span>
                                    ) : null}
                                    {historyLine ? (
                                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                        <HighlightedText text={historyLine} query={searchResult.normalizedQuery} />
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="shrink-0 text-sm font-medium text-foreground tabular-nums">{formatMoney(order.totalPrice)}</span>
                                </>
                              );

                              return (
                                <li key={order.id}>
                                  {onOpenOrder ? (
                                    <button
                                      type="button"
                                      onClick={() => onOpenOrder(order.id)}
                                      className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                                    >
                                      {content}
                                    </button>
                                  ) : (
                                    <div className="flex items-start justify-between gap-3 px-3 py-2.5">{content}</div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    ) : null}

                    {estimatesEnabled && !searchEmpty ? (
                      <div className="mt-6">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">
                            {t("clients.detail.estimateHistoryWithCount", { count: estimateSummaries.length })}
                          </h3>
                          {canCreateEstimate ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => onCreateEstimate?.(selectedClient)}
                            >
                              <Plus />
                              {t("clients.detail.createEstimate")}
                            </Button>
                          ) : null}
                        </div>
                        {estimatesLoading ? (
                          <div className="space-y-2">
                            <Skeleton className="h-12 w-full" />
                          </div>
                        ) : estimateSummaries.length === 0 ? (
                          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
                            <p className="text-[13px] font-medium text-foreground">{t("clients.detail.noEstimates")}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{t("clients.detail.noEstimatesHint")}</p>
                          </div>
                        ) : (
                          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                            {estimateSummaries.slice(0, ORDER_LIST_LIMIT).map((order) => {
                              const historyLine = clientOrderHistoryLine(
                                order,
                                shouldShowOrderAssetValue(workflow.orderFields.device, order.device, "device"),
                                shouldShowOrderAssetValue(workflow.orderFields.carNumber, order.carNumber, "carNumber"),
                                shouldShowOrderAssetValue(workflow.orderFields.vin, order.vin, "vin"),
                              );
                              const content = (
                                <>
                                  <span className="min-w-0 flex-1">
                                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                      <span className="text-sm font-medium text-primary tabular-nums">
                                        {order.orderNumber}
                                      </span>
                                      {order.estimateStatus ? (
                                        <EntityStatusBadge
                                          name={order.estimateStatus.name}
                                          color={order.estimateStatus.color}
                                        />
                                      ) : null}
                                    </span>
                                    {order.createdAt ? (
                                      <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                                        {order.createdAt}
                                      </span>
                                    ) : null}
                                    {historyLine ? (
                                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                        {historyLine}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="shrink-0 text-sm font-medium text-foreground tabular-nums">
                                    {formatMoney(order.totalPrice)}
                                  </span>
                                </>
                              );
                              return (
                                <li key={order.id}>
                                  {onOpenOrder ? (
                                    <button
                                      type="button"
                                      onClick={() => onOpenOrder(order.id)}
                                      className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                                    >
                                      {content}
                                    </button>
                                  ) : (
                                    <div className="flex items-start justify-between gap-3 px-3 py-2.5">{content}</div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activeTab === "documents" ? (
                  <ClientDocumentsTab client={selectedClient} clientOrders={clientOrders} onOpenOrder={onOpenOrder} />
                ) : null}

                {activeTab === "payments" ? (
                  <ClientPaymentsTab
                    client={selectedClient}
                    clientOrders={clientOrders}
                    payments={payments}
                    paymentsLoading={paymentsLoading}
                    ordersLoading={ordersLoading}
                    onOpenSettlement={() => setSettlementOpen(true)}
                  />
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {selectedClient && !isEditing ? (
          <footer
            data-testid="client-detail-footer"
            className={cn(
              "shrink-0 border-t border-border bg-background px-5 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]",
              // Phones wrap into two rows (primary action on its own row) so labels never truncate.
              "flex flex-wrap items-center justify-end gap-2",
            )}
          >
            {canCreateOrder ? (
              <Button
                type="button"
                className="order-first min-h-11 w-full min-w-0 sm:order-none sm:w-auto"
                onClick={() => onCreateOrder?.(selectedClient)}
              >
                <Plus />
                {t("clients.detail.createOrder")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="min-h-11 min-w-0 flex-1 sm:flex-none"
              onClick={() => setSettlementOpen(true)}
            >
              <span className="truncate">{t("clients.settlement.button")}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 min-w-0 flex-1 sm:flex-none"
              onClick={() => handleOpenChange(false)}
            >
              <span className="truncate">{t("clients.detail.tabs.closeWindow")}</span>
            </Button>
            {showMoreMenu ? (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={t("common.actions")}
                  >
                    <EllipsisVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top">
                  <DropdownMenuItem className="min-h-11" onSelect={() => setMergeOpen(true)}>
                    <Users />
                    {t("clients.detail.tabs.mergeWith")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="min-h-11 text-destructive focus:text-destructive"
                    onSelect={() => setDeleteOpen(true)}
                  >
                    <Trash2 />
                    {t("clients.detail.deleteClient")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </footer>
        ) : null}

        {selectedClient && (
          <ClientSettlementDialog
            open={settlementOpen}
            onOpenChange={setSettlementOpen}
            clientName={selectedClient.name}
            clientBalance={selectedClient.balance}
            orders={clientOrders}
            ordersLoading={ordersLoading}
            ordersError={ordersError}
            formatMoney={formatMoney}
            onOpenOrder={onOpenOrder}
          />
        )}

        {selectedClient && canMutateClients ? (
          <MergeClientsDialog
            open={mergeOpen}
            onClose={() => setMergeOpen(false)}
            clients={[selectedClient]}
            orderCountByClientId={new Map([[selectedClient.id, clientOrders.length]])}
            initialTargetClientId={selectedClient.id}
            onMerged={(survivor) => {
              // Same client (renamed) or the chosen survivor — keep the card open on it.
              onClientUpdated(survivor);
            }}
          />
        ) : null}

        <DeleteClientDialog
          client={deleteOpen ? selectedClient : null}
          onClose={() => setDeleteOpen(false)}
          onDeleted={(clientId) => {
            onClientDeleted?.(clientId);
            setDetailPanelOpen(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
