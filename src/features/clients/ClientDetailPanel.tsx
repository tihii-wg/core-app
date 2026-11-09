import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calculator, ClipboardList, MapPin, Pencil, Phone, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { OrderStatusBadge } from "../../ui/StatusBadge";
import { Skeleton } from "../../ui/Skeleton";
import ClientTypeBadge from "./ClientTypeBadge";
import type { Client, Order, OrderStatus } from "../../lib/types";
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
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { clientOrderHistoryLine, type ClientOrderSummary } from "./clientOrders";
import { filterClientCardSearch, highlightMatch, type ClientSearchableOrder } from "./clientSearch";
import { useGetPayments } from "../finance/usePayments";
import { useDebounce } from "../../hooks/useDebounce";
import { displayCustomFieldValue } from "../../services/apiCustomFields";
import { useOrderCustomFieldValuesForOrders, useOrderFieldConfig } from "../orders/useOrderFieldConfig";

type ClientDetailPanelProps = {
  selectedClient: Client | null;
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
  onClientUpdated: (client: Client) => void;
  onClientDeleted?: (clientId: string) => void;
  getClientOrders: (clientId: string) => ClientOrderSummary[];
  /** Full workspace orders (hydrated) — used for card search; summaries stay for display. */
  workspaceOrders?: Order[];
  ordersLoading?: boolean;
  ordersError?: boolean;
  onOpenOrder?: (orderId: string) => void;
  onCreateOrder?: (client: Client) => void;
};

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
}: ClientDetailPanelProps) {
  const { t } = useTranslation();
  const { workflow } = useIndustryWorkflow();
  const clientCopy = industryClientCopy(workflow);
  const showVehicles = industrySupportsClientVehicles(workflow);
  const { formatMoney } = useWorkspaceMoney();
  const { canWrite: canMutateClients } = useWorkspaceSubscription();
  const [isEditing, setIsEditing] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState(selectedClient?.id);
  const [cardSearch, setCardSearch] = useState("");
  const debouncedCardSearch = useDebounce(cardSearch, 200);

  const { vehicles } = useGetClientVehicles(showVehicles && detailPanelOpen ? selectedClient?.id : null);
  const { payments } = useGetPayments();
  const industryBlocks = industryProfile(workflow.slug).orderFieldBlocks;

  if (selectedClient?.id !== editingClientId) {
    setEditingClientId(selectedClient?.id);
    setIsEditing(false);
    setDeleteOpen(false);
    setCardSearch("");
  }

  useEffect(() => {
    if (!detailPanelOpen) setCardSearch("");
  }, [detailPanelOpen]);

  function handleOpenChange(open: boolean) {
    setDetailPanelOpen(open);
    if (!open) {
      setIsEditing(false);
      setDeleteOpen(false);
      setCardSearch("");
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

  const searchableOrders: ClientSearchableOrder[] = useMemo(() => {
    if (!selectedClient) return [];
    if (workspaceOrders && workspaceOrders.length > 0) {
      return workspaceOrders.filter((order) => order.clientId === selectedClient.id);
    }
    return clientOrders.map(summaryToSearchable);
  }, [selectedClient, workspaceOrders, clientOrders]);

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
    if (!debouncedCardSearch.trim()) return clientOrders;
    const allowed = new Set(searchResult.orderIds);
    return clientOrders.filter((order) => allowed.has(order.id));
  }, [clientOrders, debouncedCardSearch, searchResult.orderIds]);

  const visibleVehicleIds = debouncedCardSearch.trim() ? searchResult.vehicleIds : undefined;
  const searchActive = Boolean(debouncedCardSearch.trim());
  const searchEmpty =
    searchActive && filteredOrders.length === 0 && (visibleVehicleIds?.length ?? vehicles.length) === 0;

  return (
    <Sheet open={detailPanelOpen} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-24">
          <SheetTitle>
            <span className="inline-flex min-w-0 flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
              {selectedClient?.name}
              {selectedClient && <ClientTypeBadge clientType={selectedClient.client_type} />}
            </span>
          </SheetTitle>
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

        {selectedClient && isEditing && (
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
        )}

        {selectedClient && !isEditing && (
          <div className="space-y-6 px-5 py-5">
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

            <Button type="button" variant="outline" className="w-full" onClick={() => setSettlementOpen(true)}>
              <Calculator />
              {t("clients.settlement.button")}
            </Button>

            <ClientExtrasSection clientId={selectedClient.id} />

            <div className="space-y-3">
              <Input
                value={cardSearch}
                onChange={(event) => setCardSearch(event.target.value)}
                placeholder={t("clients.cardSearch.placeholder")}
                aria-label={t("clients.cardSearch.placeholder")}
                className="w-full min-w-0"
                type="search"
              />

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

              {!searchEmpty && showVehicles && (!searchActive || (visibleVehicleIds?.length ?? 0) > 0) ? (
                <ClientVehiclesSection
                  clientId={selectedClient.id}
                  onOpenOrder={onOpenOrder}
                  visibleVehicleIds={visibleVehicleIds}
                  highlightQuery={searchResult.normalizedQuery}
                />
              ) : null}

              {!searchEmpty ? (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-subtle-foreground">{t("clients.detail.orderHistory")}</h3>
                    {onCreateOrder ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => onCreateOrder(selectedClient)}>
                        <Plus />
                        {t("clients.detail.createOrder")}
                      </Button>
                    ) : null}
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
                      {filteredOrders.slice(0, searchActive ? 50 : 8).map((order) => {
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
            </div>

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

            {canMutateClients ? (
              <div className="flex justify-end border-t border-border pt-4">
                <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
                  {t("common.delete")}
                </Button>
              </div>
            ) : null}
          </div>
        )}

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
