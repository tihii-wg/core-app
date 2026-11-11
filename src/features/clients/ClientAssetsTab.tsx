import { useTranslation } from "react-i18next";
import { ChevronRight, MapPin, Smartphone } from "lucide-react";
import type { Client } from "../../lib/types";
import type { IndustryAssetKind } from "../industries/industryProfile";
import { ClientVehiclesSection } from "../vehicles/ClientVehiclesSection";
import {
  deviceAssetFilter,
  siteAssetFilter,
  type ClientAssetFilter,
  type ClientDeviceAsset,
  type ClientSiteAsset,
} from "./clientAssets";

type ClientAssetsTabProps = {
  client: Client;
  assetKind: Exclude<IndustryAssetKind, "none">;
  devices: ClientDeviceAsset[];
  sites: ClientSiteAsset[];
  onOpenOrder?: (orderId: string) => void;
  onCreateOrder?: (client: Client, vehicleId?: string) => void;
  /** Device / site tap → Orders tab filtered by this asset. */
  onSelectAsset: (filter: ClientAssetFilter) => void;
};

function EmptyAssets({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function ClientAssetsTab({
  client,
  assetKind,
  devices,
  sites,
  onOpenOrder,
  onCreateOrder,
  onSelectAsset,
}: ClientAssetsTabProps) {
  const { t } = useTranslation();

  if (assetKind === "vehicle") {
    // Always the full vehicle list — client-card search lives on the Orders tab.
    return (
      <ClientVehiclesSection
        clientId={client.id}
        onOpenOrder={onOpenOrder}
        onCreateOrder={onCreateOrder ? (vehicleId) => onCreateOrder(client, vehicleId) : undefined}
      />
    );
  }

  if (assetKind === "device") {
    if (devices.length === 0) {
      return <EmptyAssets title={t("clients.detail.assets.emptyDevices")} hint={t("clients.detail.assets.emptyHint")} />;
    }
    return (
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border" data-testid="client-assets-list">
        {devices.map((device) => {
          const filter = deviceAssetFilter(device);
          const name = device.name || t("clients.detail.assets.unnamedDevice");
          return (
            <li key={device.key}>
              <button
                type="button"
                aria-label={t("clients.detail.assets.openOrders", { name: filter.label || name })}
                onClick={() => onSelectAsset(filter)}
                className="flex min-h-11 w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
              >
                <Smartphone className="mt-0.5 size-4 shrink-0 text-subtle-foreground" aria-hidden />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-sm font-medium text-foreground [overflow-wrap:anywhere]">{name}</span>
                  {device.serial ? (
                    <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {t("clients.detail.assets.serial", { value: device.serial })}
                    </span>
                  ) : null}
                  {device.imei ? (
                    <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {t("clients.detail.assets.imei", { value: device.imei })}
                    </span>
                  ) : null}
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {[
                      device.lastOrderDate ? t("clients.detail.assets.lastOrder", { date: device.lastOrderDate }) : null,
                      t("clients.detail.assets.ordersCount", { count: device.orderCount }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-subtle-foreground" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  if (sites.length === 0) {
    return (
      <EmptyAssets
        title={assetKind === "project" ? t("clients.detail.assets.emptyObjects") : t("clients.detail.assets.emptySites")}
        hint={t("clients.detail.assets.emptyHint")}
      />
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border" data-testid="client-assets-list">
      {sites.map((site) => (
        <li key={site.key}>
          <button
            type="button"
            aria-label={t("clients.detail.assets.openOrders", { name: site.label })}
            onClick={() => onSelectAsset(siteAssetFilter(site))}
            className="flex min-h-11 w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
          >
            <MapPin className="mt-0.5 size-4 shrink-0 text-subtle-foreground" aria-hidden />
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className="block text-sm font-medium text-foreground [overflow-wrap:anywhere]">{site.label}</span>
              {site.details ? (
                <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{site.details}</span>
              ) : null}
              <span className="block text-xs text-muted-foreground tabular-nums">
                {[
                  site.lastOrderDate ? t("clients.detail.assets.lastOrder", { date: site.lastOrderDate }) : null,
                  t("clients.detail.assets.ordersCount", { count: site.orderCount }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-subtle-foreground" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
