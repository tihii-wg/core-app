import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftRight, ClipboardList, PackageMinus, PackagePlus, Settings2 } from "lucide-react";
import { languageFromPath } from "../../i18n/languages";
import { PageHeader } from "../../pages/PageHeader";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Skeleton } from "../../ui/Skeleton";
import { InventoryMovementsPanel } from "../inventory/InventoryMovementsPanel";
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
import { WarehouseOpDialog } from "../inventory/WarehouseOpDialog";
import { WarehouseOpsPanel } from "../inventory/WarehouseOpsPanel";
import type { WarehouseOpKind } from "../inventory/warehouseOps";
import { WAREHOUSE_OP_PERMISSIONS } from "../roles/permissions";
import { useMyPermissions } from "../roles/useMyPermissions";
import { WarehousesSettings } from "../settings/WarehousesSettings";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { formatWorkspaceMoney } from "../../lib/workspaceFormat";
import { useGetWarehouseStock } from "./useGetWarehouseStock";
import { useGetWarehouses } from "./useGetWarehouses";

const ALL = "all";
const itemsSort = { field: "name", ascending: true } as const;

type StockRow = {
  inventoryItemId: string;
  name: string;
  quantity: number;
  minQuantity: number | null;
  unit: string;
};

export function Warehouses() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const manageRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);

  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const { canWrite } = useWorkspaceSubscription();
  const { can } = useMyPermissions();
  const { data: warehouses = [], isLoading, isError, refetch } = useGetWarehouses();
  const { data: stock = [], isLoading: stockLoading } = useGetWarehouseStock();
  const { items } = useGetInventoryItems("", "all", itemsSort);

  const activeWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.isActive), [warehouses]);
  const defaultId = activeWarehouses.find((warehouse) => warehouse.isDefault)?.id ?? activeWarehouses[0]?.id ?? ALL;
  const [warehouseFilter, setWarehouseFilter] = useState(defaultId);
  const [createKind, setCreateKind] = useState<WarehouseOpKind | null>(null);

  // Keep selector valid when the warehouse list loads or changes.
  const selectedId = useMemo(() => {
    if (warehouseFilter === ALL) return ALL;
    if (activeWarehouses.some((warehouse) => warehouse.id === warehouseFilter)) return warehouseFilter;
    return defaultId;
  }, [activeWarehouses, defaultId, warehouseFilter]);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const stockRows = useMemo((): StockRow[] => {
    const relevant =
      selectedId === ALL ? stock : stock.filter((row) => row.warehouseId === selectedId && row.quantity !== 0);

    if (selectedId === ALL) {
      const totals = new Map<string, number>();
      for (const row of stock) {
        totals.set(row.inventoryItemId, (totals.get(row.inventoryItemId) ?? 0) + (Number(row.quantity) || 0));
      }
      return [...totals.entries()]
        .map(([inventoryItemId, quantity]) => {
          const item = itemById.get(inventoryItemId);
          return {
            inventoryItemId,
            name: item?.name || stock.find((row) => row.inventoryItemId === inventoryItemId)?.itemName || inventoryItemId,
            quantity,
            minQuantity: item?.minQuantity ?? null,
            unit: item?.unit || "",
          };
        })
        .filter((row) => row.quantity !== 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    return relevant
      .map((row) => {
        const item = itemById.get(row.inventoryItemId);
        return {
          inventoryItemId: row.inventoryItemId,
          name: row.itemName || item?.name || row.inventoryItemId,
          quantity: Number(row.quantity) || 0,
          minQuantity: row.minQuantity ?? item?.minQuantity ?? null,
          unit: item?.unit || "",
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [itemById, selectedId, stock]);

  const lowCount = stockRows.filter((row) => row.minQuantity != null && row.quantity > 0 && row.quantity <= row.minQuantity).length;
  const outCount = stockRows.filter((row) => row.quantity <= 0).length;
  const productCount = stockRows.filter((row) => row.quantity > 0).length;

  const selectedName =
    selectedId === ALL
      ? t("warehouses.allWarehouses")
      : (activeWarehouses.find((warehouse) => warehouse.id === selectedId)?.name ?? t("warehouses.allWarehouses"));

  const canCreate = (kind: WarehouseOpKind) => canWrite && can(WAREHOUSE_OP_PERMISSIONS[kind].create);

  function scrollToManage() {
    manageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToHistory() {
    historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openInventory() {
    const locale = languageFromPath(location.pathname);
    const workspaceId = location.pathname.split("/")[2];
    navigate(`/${locale}/${workspaceId}/inventory`);
  }

  const formatMoney = (value: number) => formatWorkspaceMoney(value, workspace?.currency);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("warehouses.title")}
        description={
          isLoading
            ? t("warehouses.loading")
            : isError
              ? t("warehouses.loadError")
              : t("warehouses.currentWarehouse", { name: selectedName })
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={openInventory}>
              {t("warehouses.openInventory")}
            </Button>
            <Button type="button" variant="outline" onClick={scrollToManage}>
              <Settings2 />
              {t("warehouses.manage")}
            </Button>
          </div>
        }
      />

      {isError ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            <p className="text-sm text-destructive">{t("warehouses.loadError")}</p>
            <Button type="button" variant="outline" onClick={() => refetch()}>
              {t("common.retry")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="w-full space-y-1.5 sm:max-w-xs">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="warehouse-scope">
            {t("warehouses.selectorLabel")}
          </label>
          <Select value={selectedId} onValueChange={setWarehouseFilter} disabled={isLoading}>
            <SelectTrigger id="warehouse-scope" className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("warehouses.allWarehouses")}</SelectItem>
              {activeWarehouses.map((warehouse) => (
                <SelectItem key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                  {warehouse.isDefault ? ` · ${t("settings.warehouses.default")}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2">
          {canCreate("receipt") ? (
            <Button type="button" size="sm" onClick={() => setCreateKind("receipt")}>
              <PackagePlus />
              {t("warehouses.actions.receive")}
            </Button>
          ) : null}
          {canCreate("transfer") ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setCreateKind("transfer")}>
              <ArrowLeftRight />
              {t("warehouses.actions.transfer")}
            </Button>
          ) : null}
          {canCreate("writeOff") ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setCreateKind("writeOff")}>
              <PackageMinus />
              {t("warehouses.actions.writeOff")}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={scrollToHistory}>
            <ClipboardList />
            {t("warehouses.actions.history")}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label={t("warehouses.summary.warehouses")} value={String(activeWarehouses.length)} loading={isLoading} />
        <SummaryCard label={t("warehouses.summary.products")} value={String(productCount)} loading={stockLoading} />
        <SummaryCard label={t("warehouses.summary.lowStock")} value={String(lowCount)} loading={stockLoading} tone="warning" />
        <SummaryCard label={t("warehouses.summary.outOfStock")} value={String(outCount)} loading={stockLoading} tone="danger" />
      </div>

      {!isLoading && activeWarehouses.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("warehouses.emptyTitle")}</CardTitle>
            <CardDescription>{t("warehouses.emptyDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" onClick={scrollToManage}>
              {t("warehouses.manage")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{selectedId === ALL ? t("warehouses.stock.titleAll") : t("warehouses.stock.title")}</CardTitle>
          <CardDescription>{selectedName}</CardDescription>
        </CardHeader>
        <CardContent>
          {stockLoading ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : stockRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("warehouses.stock.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[20rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-2 py-2 font-medium">{t("warehouses.stock.product")}</th>
                    <th className="px-2 py-2 text-right font-medium">{t("warehouses.stock.quantity")}</th>
                    <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">{t("warehouses.stock.min")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stockRows.slice(0, 40).map((row) => {
                    const low = row.minQuantity != null && row.quantity <= row.minQuantity;
                    return (
                      <tr key={row.inventoryItemId}>
                        <td className="max-w-[14rem] truncate px-2 py-2 font-medium text-foreground" title={row.name}>
                          {row.name}
                        </td>
                        <td className={`px-2 py-2 text-right tabular-nums ${low ? "font-medium text-destructive" : "text-foreground"}`}>
                          {row.quantity}
                          {row.unit ? ` ${row.unit}` : ""}
                        </td>
                        <td className="hidden px-2 py-2 text-right tabular-nums text-muted-foreground sm:table-cell">
                          {row.minQuantity ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <WarehouseOpsPanel />

      <div ref={historyRef}>
        <InventoryMovementsPanel />
      </div>

      <div ref={manageRef} id="warehouse-manage" className="scroll-mt-20">
        <WarehousesSettings />
      </div>

      {createKind ? (
        <WarehouseOpDialog
          kind={createKind}
          open
          onOpenChange={(open) => {
            if (!open) setCreateKind(null);
          }}
          warehouses={warehouses}
          items={items}
          stock={stock}
          formatMoney={formatMoney}
        />
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  loading,
  tone,
}: {
  label: string;
  value: string;
  loading?: boolean;
  tone?: "warning" | "danger";
}) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <p
            className={
              tone === "danger"
                ? "text-2xl font-semibold tabular-nums text-destructive"
                : tone === "warning"
                  ? "text-2xl font-semibold tabular-nums text-warning"
                  : "text-2xl font-semibold tabular-nums text-foreground"
            }
          >
            {value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
