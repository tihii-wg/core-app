import { useState } from "react";
import { ClipboardList, Mail, Pencil, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Order } from "../../lib/types";
import { Button } from "../../ui/Button";
import { ErrorState } from "../../ui/EmptyState";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { Skeleton } from "../../ui/Skeleton";
import { OrderStatusBadge } from "../../ui/StatusBadge";
import { vehicleDisplayLabel } from "../../services/apiVehicles";
import ClientTypeBadge from "../clients/ClientTypeBadge";
import { useGetClient } from "../clients/useGetClient";
import { VehicleFieldsGrid } from "../orders/VehicleFieldsGrid";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { SubscriptionReadOnlyNotice } from "../workspaces/SubscriptionReadOnlyNotice";
import { useGetVehicle } from "./useGetVehicle";
import { useGetVehicleOrders } from "./useGetVehicleOrders";
import { useUpdateVehicle } from "./useVehicleMutations";
import { VehicleFormDialog } from "./VehicleFormDialog";
import { VehicleMileageForm } from "./VehicleMileageForm";

type VehicleDetailPanelProps = {
  vehicleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, owner click uses this instead of a no-op (parent opens Client Details). */
  onOpenClient?: (clientId: string) => void;
  /** When set, order history uses this (parent opens Order Details). */
  onOpenOrder?: (order: Order) => void;
};

export function VehicleDetailPanel({
  vehicleId,
  open,
  onOpenChange,
  onOpenClient,
  onOpenOrder,
}: VehicleDetailPanelProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const { canWrite } = useWorkspaceSubscription();
  const id = vehicleId?.trim() || "";
  const { vehicle, isLoading, isError, notFound, refetch } = useGetVehicle(open && id ? id : null);
  const { client, isLoading: clientLoading, notFound: clientNotFound } = useGetClient(
    open && vehicle?.clientId ? vehicle.clientId : null,
  );
  const {
    orders,
    isLoading: ordersLoading,
    isError: ordersError,
    refetch: refetchOrders,
  } = useGetVehicleOrders(open && vehicle?.id ? vehicle.id : null);
  const updateVehicle = useUpdateVehicle(vehicle?.clientId ?? "");
  const [editOpen, setEditOpen] = useState(false);
  const empty = t("common.noValue");

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setEditOpen(false);
    onOpenChange(nextOpen);
  }

  const owner = vehicle && client && client.id === vehicle.clientId ? client : null;
  const ownerEmail = owner?.email?.trim() ?? "";
  const ownerPhone = owner?.phone?.trim() ?? "";
  const ownerName = owner
    ? owner.name
    : clientLoading
      ? t("common.loading")
      : t("vehicles.errors.clientNotFound");

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg" data-testid="vehicle-detail-panel">
          <SheetHeader className="pr-24">
            <SheetTitle className="[overflow-wrap:anywhere]">
              {vehicle ? vehicleDisplayLabel(vehicle) : t("vehicles.details.title")}
            </SheetTitle>
            {vehicle && canWrite ? (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                aria-label={t("common.edit")}
                title={t("vehicles.edit")}
                className="absolute top-3.5 right-12 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35"
              >
                <Pencil className="size-4" />
              </button>
            ) : null}
            <SheetDescription className="sr-only">{t("vehicles.details.subtitle")}</SheetDescription>
          </SheetHeader>

          <div className="space-y-5 px-5 py-5">
            <SubscriptionReadOnlyNotice />

            {!id ? null : isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : isError ? (
              <ErrorState title={t("vehicles.loadFailed")} onRetry={() => void refetch()} />
            ) : notFound || !vehicle ? (
              <ErrorState title={t("vehicles.errors.notFound")} />
            ) : (
              <>
                <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/50 p-4">
                  <div className="min-w-0 space-y-2">
                    <div>
                      <h3 className="text-xs font-medium text-muted-foreground">{t("vehicles.details.ownerTitle")}</h3>
                      {clientNotFound || !owner ? (
                        <p className="mt-1 font-medium [overflow-wrap:anywhere] text-muted-foreground">{ownerName}</p>
                      ) : onOpenClient ? (
                        <button
                          type="button"
                          className="mt-1 text-left font-medium text-primary [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                          onClick={() => onOpenClient(vehicle.clientId)}
                        >
                          {owner.name}
                        </button>
                      ) : (
                        <p className="mt-1 font-medium [overflow-wrap:anywhere] text-foreground">{owner.name}</p>
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
                  <h3 className="mb-3 text-xs font-medium text-muted-foreground">{t("vehicles.details.orderHistoryTitle")}</h3>
                  {ordersLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : ordersError ? (
                    <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
                      <p className="text-[13px] font-medium text-foreground">{t("vehicles.details.ordersLoadFailed")}</p>
                      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refetchOrders()}>
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
                              onClick={() => onOpenOrder?.(order)}
                              disabled={!onOpenOrder}
                              className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:cursor-default disabled:hover:bg-transparent"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="text-sm font-medium text-primary tabular-nums">{order.orderNumber}</span>
                                  <OrderStatusBadge status={order.status} />
                                </span>
                                {order.createdAt ? (
                                  <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">{order.createdAt}</span>
                                ) : null}
                                {secondary ? (
                                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{secondary}</span>
                                ) : null}
                              </span>
                              <span className="shrink-0 text-sm font-medium text-foreground tabular-nums">
                                {formatMoney(order.totalPrice)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {vehicle ? (
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
      ) : null}
    </>
  );
}
