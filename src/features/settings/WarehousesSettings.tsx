import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { useGetLocations } from "../locations/useGetLocations";
import { useGetBinLocations, useGetWarehouses } from "../warehouses/useGetWarehouses";
import { useGetWarehouseStock } from "../warehouses/useGetWarehouseStock";
import type { BinLocationRecord } from "../../services/apiWarehouses";
import type { WarehouseStockRecord } from "../../services/apiWarehouseStock";

const STOCK_PREVIEW_LIMIT = 8;

export function WarehousesSettings() {
  const { t } = useTranslation();
  const { data: warehouses = [], isLoading, error } = useGetWarehouses();
  const { data: bins = [] } = useGetBinLocations();
  const { data: locations = [] } = useGetLocations();
  // Read-only; an empty result (table missing / no rows) simply hides the per-warehouse stock block.
  const { data: stock = [] } = useGetWarehouseStock();

  const stockByWarehouse = useMemo(() => {
    const map = new Map<string, WarehouseStockRecord[]>();
    for (const row of stock) {
      const list = map.get(row.warehouseId) ?? [];
      list.push(row);
      map.set(row.warehouseId, list);
    }
    return map;
  }, [stock]);

  const binsByWarehouse = useMemo(() => {
    const map = new Map<string, BinLocationRecord[]>();
    for (const bin of bins) {
      const list = map.get(bin.warehouseId) ?? [];
      list.push(bin);
      map.set(bin.warehouseId, list);
    }
    return map;
  }, [bins]);
  const locationNames = useMemo(() => new Map(locations.map((location) => [location.id, location.name])), [locations]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.warehouses.title")}</CardTitle>
        <CardDescription>{t("settings.warehouses.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground">{t("settings.warehouses.loading")}</p> : null}
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        {!isLoading && !error && warehouses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.warehouses.empty")}</p>
        ) : null}
        {warehouses.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {warehouses.map((warehouse) => {
              const warehouseBins = binsByWarehouse.get(warehouse.id) ?? [];
              const warehouseStock = stockByWarehouse.get(warehouse.id) ?? [];
              const locationName = warehouse.locationId ? locationNames.get(warehouse.locationId) : undefined;
              return (
                <li key={warehouse.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{warehouse.name}</p>
                      {warehouse.isDefault ? (
                        <span className="text-xs text-muted-foreground">{t("settings.warehouses.default")}</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t(`settings.warehouses.types.${warehouse.warehouseType}`)}
                      {locationName ? ` · ${locationName}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {warehouseBins.length === 0
                        ? t("settings.warehouses.noBins")
                        : `${t("settings.warehouses.bins")}: ${warehouseBins
                            .map((bin) => bin.name)
                            .join(", ")}`}
                    </p>
                    {warehouseStock.length > 0 ? (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-foreground">{t("settings.warehouses.stock")}</p>
                        <ul className="mt-1 space-y-0.5">
                          {warehouseStock.slice(0, STOCK_PREVIEW_LIMIT).map((row) => (
                            <li key={row.id} className="flex justify-between gap-4 text-xs text-muted-foreground">
                              <span className="truncate">{row.itemName || t("settings.warehouses.unknownItem")}</span>
                              <span
                                className={
                                  row.minQuantity != null && row.quantity < row.minQuantity
                                    ? "shrink-0 font-medium text-destructive"
                                    : "shrink-0 text-foreground"
                                }
                              >
                                {row.quantity}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {warehouseStock.length > STOCK_PREVIEW_LIMIT ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("settings.warehouses.stockMore", { count: warehouseStock.length - STOCK_PREVIEW_LIMIT })}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {warehouse.isActive ? t("settings.warehouses.active") : t("settings.warehouses.inactive")}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
