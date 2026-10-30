import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ClipboardList, Mail, Pencil, Phone } from "lucide-react";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { OrderStatusBadge } from "../../ui/StatusBadge";
import { vehicleDisplayLabel } from "../../services/apiVehicles";
import { VehicleFieldsGrid } from "../orders/OrderLinkedVehicleDetails";
import { useGetVehicle } from "./useGetVehicle";
import { useGetVehicleOrders } from "./useGetVehicleOrders";
import { VehicleMileageForm } from "./VehicleMileageForm";
import { VehicleFormDialog } from "./VehicleFormDialog";
import { useUpdateVehicle } from "./useVehicleMutations";
import { ordersListPath } from "./vehicleRoutes";
import { useGetClient } from "../clients/useGetClient";
import { ClientDetailsHost } from "../clients/ClientDetailsHost";
import { useOpenClientDetails } from "../clients/useOpenClientDetails";
import ClientTypeBadge from "../clients/ClientTypeBadge";
import { useOrderDetails } from "../orders/useOrderDetails";
import OrderDetailPanel from "../orders/OrderDetailPanel";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { SubscriptionReadOnlyNotice } from "../workspaces/SubscriptionReadOnlyNotice";

function BackToOrdersLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      {label}
    </Link>
  );
}

export function VehicleDetailsPage() {
  const { t } = useTranslation();
  const { locale = "en", workspaceId = "", vehicleId = "" } = useParams();
  const { formatMoney } = useWorkspaceMoney();
  const { canWrite } = useWorkspaceSubscription();
  const { vehicle, isLoading, isError, notFound, refetch } = useGetVehicle(vehicleId);
  const { client, isLoading: clientLoading, notFound: clientNotFound } = useGetClient(vehicle?.clientId);
  const { orders, isLoading: ordersLoading, isError: ordersError, refetch: refetchOrders } = useGetVehicleOrders(
    vehicle?.id ?? null,
  );
  const updateVehicle = useUpdateVehicle(vehicle?.clientId ?? "");
  const clientDetails = useOpenClientDetails();
  const orderDetails = useOrderDetails();
  const [editOpen, setEditOpen] = useState(false);
  const empty = t("common.noValue");
  const ordersPath = ordersListPath(locale, workspaceId);

  const owner = vehicle && client && client.id === vehicle.clientId ? client : null;
  const ownerEmail = owner?.email?.trim() ?? "";
  const ownerPhone = owner?.phone?.trim() ?? "";

  const backLabel = t("vehicles.details.backToOrders");

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-36" />
        <div className="w-full overflow-hidden rounded-lg border border-border bg-elevated shadow-xs sm:max-w-lg">
          <div className="border-b border-border px-5 py-4">
            <Skeleton className="h-6 w-2/3" />
          </div>
          <div className="space-y-4 px-5 py-5">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <BackToOrdersLink to={ordersPath} label={backLabel} />
        <ErrorState title={t("vehicles.loadFailed")} onRetry={() => refetch()} />
      </div>
    );
  }

  if (notFound || !vehicle) {
    return (
      <div className="space-y-4">
        <BackToOrdersLink to={ordersPath} label={backLabel} />
        <ErrorState title={t("vehicles.errors.notFound")} />
      </div>
    );
  }

  const ownerName = owner ? owner.name : clientLoading ? t("common.loading") : t("vehicles.errors.clientNotFound");

  return (
    <div className="space-y-4">
      <BackToOrdersLink to={ordersPath} label={backLabel} />
      <SubscriptionReadOnlyNotice />

      <div className="w-full overflow-hidden rounded-lg border border-border bg-elevated shadow-xs sm:max-w-lg">
        <div className="relative border-b border-border px-5 py-4 pr-14">
          <h1 className="text-base leading-6 font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">
            {vehicleDisplayLabel(vehicle)}
          </h1>
          {canWrite ? (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              aria-label={t("common.edit")}
              title={t("vehicles.edit")}
              className="absolute top-3.5 right-3.5 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35"
            >
              <Pencil className="size-4" />
            </button>
          ) : null}
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/50 p-4">
            <div className="min-w-0 space-y-2">
              <div>
                <h2 className="text-xs font-medium text-muted-foreground">{t("vehicles.details.ownerTitle")}</h2>
                {clientNotFound || !owner ? (
                  <p className="mt-1 font-medium [overflow-wrap:anywhere] text-muted-foreground">{ownerName}</p>
                ) : (
                  <button
                    type="button"
                    className="mt-1 text-left font-medium text-primary [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                    onClick={() => void clientDetails.openClient(vehicle.clientId, owner)}
                  >
                    {owner.name}
                  </button>
                )}
              </div>
              {owner?.client_type ? (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground">{t("clients.table.clientType")}</h3>
                  <div className="mt-1">
                    <ClientTypeBadge clientType={owner.client_type} />
                  </div>
                </div>
              ) : null}
              {(ownerPhone || ownerEmail) && (
                <div className="space-y-1.5 pt-1 text-sm">
                  {ownerPhone ? (
                    <div className="flex items-center gap-2">
                      <Phone className="size-3.5 shrink-0 text-subtle-foreground" />
                      <a href={`tel:${ownerPhone}`} className="tabular-nums text-foreground hover:underline">
                        {ownerPhone}
                      </a>
                    </div>
                  ) : null}
                  {ownerEmail ? (
                    <div className="flex min-w-0 items-center gap-2">
                      <Mail className="size-3.5 shrink-0 text-subtle-foreground" />
                      <a href={`mailto:${ownerEmail}`} className="truncate text-primary hover:underline">
                        {ownerEmail}
                      </a>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            {vehicle.licensePlate ? (
              <div className="shrink-0 text-right">
                <h3 className="text-xs font-medium text-muted-foreground">{t("vehicles.fields.licensePlate")}</h3>
                <p className="mt-1 text-sm font-semibold tracking-tight text-foreground">{vehicle.licensePlate}</p>
              </div>
            ) : null}
          </div>

          <VehicleFieldsGrid vehicle={vehicle} empty={empty} hideKeys={["currentMileage", "licensePlate"]} />

          <div className="border-t border-border pt-5">
            <VehicleMileageForm vehicle={vehicle} canEdit={canWrite} />
          </div>

          <div className="border-t border-border pt-5">
            <h2 className="mb-3 text-xs font-medium text-muted-foreground">{t("vehicles.details.orderHistoryTitle")}</h2>
            {ordersLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : ordersError ? (
              <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
                <p className="text-[13px] font-medium text-foreground">{t("vehicles.details.ordersLoadFailed")}</p>
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => refetchOrders()}>
                  {t("common.retry")}
                </Button>
              </div>
            ) : orders.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
                <ClipboardList aria-hidden="true" className="mx-auto size-5 text-subtle-foreground" />
                <p className="mt-2 text-[13px] font-medium text-foreground">{t("vehicles.details.noOrders")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("vehicles.details.noOrdersHint")}</p>
              </div>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {orders.map((order) => {
                  const secondary = [order.service?.trim(), order.description?.trim()].filter(Boolean).join(" · ");

                  return (
                    <li key={order.id}>
                      <button
                        type="button"
                        onClick={() => {
                          clientDetails.setDetailPanelOpen(false);
                          orderDetails.openOrder(order);
                        }}
                        className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-medium text-primary tabular-nums">{order.orderNumber}</span>
                            <OrderStatusBadge status={order.status} />
                          </span>
                          {order.createdAt ? (
                            <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">{order.createdAt}</span>
                          ) : null}
                          {secondary ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{secondary}</span> : null}
                        </span>
                        <span className="shrink-0 text-sm font-medium text-foreground tabular-nums">{formatMoney(order.totalPrice)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <VehicleFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title={t("vehicles.editTitle")}
        description={t("vehicles.editDescription")}
        initial={vehicle}
        submitting={updateVehicle.isPending}
        onSubmit={async (input) => {
          await updateVehicle.mutateAsync({ vehicleId: vehicle.id, input });
        }}
      />

      <ClientDetailsHost
        selectedClient={clientDetails.selectedClient}
        detailPanelOpen={clientDetails.detailPanelOpen}
        setDetailPanelOpen={clientDetails.setDetailPanelOpen}
        onClientUpdated={clientDetails.onClientUpdated}
        onOpenOrder={(order) => {
          clientDetails.setDetailPanelOpen(false);
          orderDetails.openOrder(order);
        }}
      />

      <OrderDetailPanel {...orderDetails.panelProps} />
    </div>
  );
}
