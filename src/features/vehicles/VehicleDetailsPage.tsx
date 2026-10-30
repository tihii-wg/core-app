import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronRight, ClipboardList } from "lucide-react";
import { PageHeader } from "../../pages/PageHeader";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { OrderStatusBadge } from "../../ui/StatusBadge";
import { vehicleDisplayLabel } from "../../services/apiVehicles";
import { VehicleFieldsGrid } from "../orders/OrderLinkedVehicleDetails";
import { useGetVehicle } from "./useGetVehicle";
import { useGetVehicleOrders } from "./useGetVehicleOrders";
import { VehicleMileageForm } from "./VehicleMileageForm";
import { clientDetailsPath } from "./vehicleRoutes";
import { useGetClient } from "../clients/useGetClient";
import { ClientDetailsHost } from "../clients/ClientDetailsHost";
import { useOpenClientDetails } from "../clients/useOpenClientDetails";
import { useOrderDetails } from "../orders/useOrderDetails";
import OrderDetailPanel from "../orders/OrderDetailPanel";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { SubscriptionReadOnlyNotice } from "../workspaces/SubscriptionReadOnlyNotice";

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
  const clientDetails = useOpenClientDetails();
  const orderDetails = useOrderDetails();
  const empty = t("common.noValue");

  const owner = vehicle && client && client.id === vehicle.clientId ? client : null;
  const clientsPath = `/${locale}/${workspaceId}/clients`;
  const ownerPath = vehicle ? clientDetailsPath(locale, workspaceId, vehicle.clientId) : clientsPath;

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-8 w-2/3 max-w-md" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError) {
    return <ErrorState title={t("vehicles.loadFailed")} onRetry={() => refetch()} />;
  }

  if (notFound || !vehicle) {
    return (
      <div className="space-y-4">
        <Link
          to={clientsPath}
          className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("vehicles.details.backToClients")}
        </Link>
        <ErrorState title={t("vehicles.errors.notFound")} />
      </div>
    );
  }

  const ownerName = owner ? owner.name : clientLoading ? t("common.loading") : t("vehicles.errors.clientNotFound");

  return (
    <div className="space-y-5">
      <nav aria-label={t("vehicles.details.breadcrumb")} className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          to={clientsPath}
          className="rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
        >
          {t("nav.modules.clients")}
        </Link>
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
        {owner ? (
          <Link
            to={ownerPath}
            className="min-w-0 truncate rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
          >
            {owner.name}
          </Link>
        ) : (
          <span className="min-w-0 truncate">{ownerName}</span>
        )}
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate font-medium text-foreground">{vehicleDisplayLabel(vehicle)}</span>
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={owner ? ownerPath : clientsPath}
          className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {owner ? t("vehicles.details.backToClient") : t("vehicles.details.backToClients")}
        </Link>
      </div>

      <PageHeader title={vehicleDisplayLabel(vehicle)} description={t("vehicles.details.subtitle")} />

      <SubscriptionReadOnlyNotice />

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">{t("vehicles.details.infoTitle")}</h2>
        <VehicleFieldsGrid vehicle={vehicle} empty={empty} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">{t("vehicles.details.ownerTitle")}</h2>
        {clientNotFound || !owner ? (
          <p className="text-sm text-muted-foreground">{t("vehicles.errors.clientNotFound")}</p>
        ) : (
          <button
            type="button"
            className="text-left text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
            onClick={() => void clientDetails.openClient(vehicle.clientId, owner)}
          >
            {owner.name}
          </button>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">{t("vehicles.details.mileageTitle")}</h2>
        <VehicleMileageForm vehicle={vehicle} canEdit={canWrite} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">{t("vehicles.details.orderHistoryTitle")}</h2>
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
      </section>

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
