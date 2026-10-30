import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Calculator, ClipboardList, Mail, MapPin, Pencil, Phone, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { Button } from "../../ui/Button";
import { OrderStatusBadge } from "../../ui/StatusBadge";
import { Skeleton } from "../../ui/Skeleton";
import ClientTypeBadge from "./ClientTypeBadge";
import type { Client } from "../../lib/types";
import { industryClientCopy, shouldShowOrderAssetValue } from "../industries/industryWorkflow";
import { industrySupportsClientVehicles } from "../industries/industryCapabilities";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { ClientVehiclesSection } from "../vehicles/ClientVehiclesSection";
import EditClientForm from "./EditClientForm";
import ClientSettlementDialog from "./ClientSettlementDialog";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { clientOrderHistoryLine, type ClientOrderSummary } from "./clientOrders";

type ClientDetailPanelProps = {
  selectedClient: Client | null;
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
  onClientUpdated: (client: Client) => void;
  getClientOrders: (clientId: string) => ClientOrderSummary[];
  ordersLoading?: boolean;
  ordersError?: boolean;
  onOpenOrder?: (orderId: string) => void;
  onCreateOrder?: (client: Client) => void;
};

export default function ClientDetailPanel({
  selectedClient,
  detailPanelOpen,
  setDetailPanelOpen,
  onClientUpdated,
  getClientOrders,
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
  const [isEditing, setIsEditing] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState(selectedClient?.id);

  if (selectedClient?.id !== editingClientId) {
    setEditingClientId(selectedClient?.id);
    setIsEditing(false);
  }

  function handleOpenChange(open: boolean) {
    setDetailPanelOpen(open);
    if (!open) setIsEditing(false);
  }

  const email = selectedClient?.email?.trim() ?? "";
  const phone = selectedClient?.phone?.trim() ?? "";
  const address = selectedClient?.address?.trim() ?? "";
  const notes = selectedClient?.notes?.trim() ?? "";
  const contactPerson = selectedClient?.contact_person?.trim() ?? "";
  const taxId = selectedClient?.tax_id?.trim() ?? "";
  const isOrganization = selectedClient?.client_type === "organization";
  const hasContact =
    Boolean(email) ||
    Boolean(phone) ||
    Boolean(address) ||
    (isOrganization && Boolean(contactPerson)) ||
    (isOrganization && Boolean(taxId));

  const clientOrders = selectedClient ? getClientOrders(selectedClient.id) : [];

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
                  {email ? (
                    <div className="flex min-w-0 items-center gap-2">
                      <Mail className="size-4 shrink-0 text-subtle-foreground" />
                      <a href={`mailto:${email}`} className="truncate text-primary hover:underline">
                        {email}
                      </a>
                    </div>
                  ) : null}
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
              <p className={`mt-1 truncate text-2xl font-semibold tracking-tight tabular-nums ${selectedClient.balance > 0 ? "text-destructive" : "text-foreground"}`}>
                {formatMoney(selectedClient.balance)}
              </p>
            </div>

            <Button type="button" variant="outline" className="w-full" onClick={() => setSettlementOpen(true)}>
              <Calculator />
              {t("clients.settlement.button")}
            </Button>

            {showVehicles ? (
              <ClientVehiclesSection clientId={selectedClient.id} onOpenOrder={onOpenOrder} />
            ) : null}

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
              ) : clientOrders.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
                  <ClipboardList aria-hidden="true" className="mx-auto size-5 text-subtle-foreground" />
                  <p className="mt-2 text-[13px] font-medium text-foreground">{t("clients.detail.noOrders")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t("clients.detail.noOrdersHint")}</p>
                </div>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {clientOrders.slice(0, 8).map((order) => {
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
                            <span className="text-sm font-medium text-primary tabular-nums">{order.orderNumber}</span>
                            <OrderStatusBadge status={order.status} />
                          </span>
                          {order.createdAt ? <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">{order.createdAt}</span> : null}
                          {historyLine ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{historyLine}</span> : null}
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
      </SheetContent>
    </Sheet>
  );
}
