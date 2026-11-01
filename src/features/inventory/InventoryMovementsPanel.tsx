import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { ErrorState } from "../../ui/EmptyState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Skeleton } from "../../ui/Skeleton";
import type { InventoryMovementType } from "../../lib/types";
import { formatWorkspaceDate } from "../../lib/workspaceFormat";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWarehouses } from "../warehouses/useGetWarehouses";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useGetInventoryItems } from "./useGetInventoryItems";
import { useWorkspaceInventoryMovements } from "./useInventoryMovements";

const itemsSort = { field: "name", ascending: true } as const;

/** Inventory → History: recent stock movements with type / product / warehouse filters. */
export function InventoryMovementsPanel() {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const { data: movements = [], isLoading, isError, refetch } = useWorkspaceInventoryMovements(50);
  const { data: warehouses = [] } = useGetWarehouses();
  const { items } = useGetInventoryItems("", "all", itemsSort);

  const [typeFilter, setTypeFilter] = useState<"all" | InventoryMovementType>("all");
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [itemFilter, setItemFilter] = useState("all");

  const warehouseNames = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name])),
    [warehouses],
  );
  const itemNames = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items]);

  const rows = useMemo(() => {
    return movements.filter((movement) => {
      if (typeFilter !== "all" && movement.movementType !== typeFilter) return false;
      if (warehouseFilter !== "all" && movement.warehouseId !== warehouseFilter) return false;
      if (itemFilter !== "all" && movement.inventoryItemId !== itemFilter) return false;
      return true;
    });
  }, [itemFilter, movements, typeFilter, warehouseFilter]);

  function movementLabel(type: InventoryMovementType) {
    if (type === "issue") return t("inventory.detail.movementIssue");
    if (type === "return") return t("inventory.detail.movementReturn");
    return t("inventory.detail.movementAdjustment");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("inventory.history.title")}</CardTitle>
        <CardDescription>{t("inventory.history.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as "all" | InventoryMovementType)}>
            <SelectTrigger className="h-9 w-full text-[13px] sm:w-40" aria-label={t("inventory.history.filters.type")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("inventory.history.filters.allTypes")}</SelectItem>
              <SelectItem value="issue">{t("inventory.detail.movementIssue")}</SelectItem>
              <SelectItem value="return">{t("inventory.detail.movementReturn")}</SelectItem>
              <SelectItem value="adjustment">{t("inventory.detail.movementAdjustment")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
            <SelectTrigger className="h-9 w-full text-[13px] sm:w-48" aria-label={t("inventory.history.filters.warehouse")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("inventory.history.filters.allWarehouses")}</SelectItem>
              {warehouses.map((warehouse) => (
                <SelectItem key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={itemFilter} onValueChange={setItemFilter}>
            <SelectTrigger className="h-9 w-full text-[13px] sm:w-52" aria-label={t("inventory.history.filters.product")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("inventory.history.filters.allProducts")}</SelectItem>
              {items.slice(0, 200).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : null}

        {isError ? (
          <ErrorState
            title={t("inventory.history.loadError.title")}
            description={t("inventory.history.loadError.description")}
            onRetry={() => refetch()}
          />
        ) : null}

        {!isLoading && !isError && movements.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("inventory.history.empty")}</p>
        ) : null}

        {!isLoading && !isError && movements.length > 0 && rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("inventory.history.filtersEmpty")}</p>
        ) : null}

        {!isLoading && !isError && rows.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((movement) => {
              const sign = movement.movementType === "return" || movement.movementType === "adjustment" ? "+" : "−";
              const productName = itemNames.get(movement.inventoryItemId) ?? t("inventory.history.unknownProduct");
              const warehouseName = movement.warehouseId
                ? warehouseNames.get(movement.warehouseId) ?? t("inventory.detail.unknownWarehouse")
                : null;
              return (
                <li key={movement.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-[13px]">
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium text-foreground">
                      {movementLabel(movement.movementType)}
                      <span className="font-normal text-muted-foreground"> · {productName}</span>
                    </p>
                    <p className="text-muted-foreground tabular-nums">
                      {formatWorkspaceDate(movement.createdAt, workspace?.dateFormat, workspace?.timezone)}
                      {warehouseName ? ` · ${warehouseName}` : ""}
                      {movement.orderId ? ` · ${movement.orderId.slice(0, 8)}` : ""}
                    </p>
                    {movement.reason ? (
                      <p className="text-muted-foreground [overflow-wrap:anywhere]">{movement.reason}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 tabular-nums font-medium text-foreground">
                    {t("inventory.detail.movementQty", { sign, quantity: movement.quantity })}
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
