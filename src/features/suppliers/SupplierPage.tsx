import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Button } from "../../ui/Button";
import { EmptyState, ErrorState } from "../../ui/EmptyState";
import { Spinner } from "../../ui/Spinner";
import { StatusBadge } from "../../ui/StatusBadge";
import { PageHeader } from "../../pages/PageHeader";
import { useIsMobile } from "../../hooks/use-mobile";
import { cn } from "../../lib/utils";
import type { InventoryItem } from "../../lib/types";
import type { SupplierDelivery } from "../../services/apiWarehouseOps";
import { financeDateKey } from "../finance/financeStats";
import InventoryDetailPanel from "../inventory/InventoryDetailPanel";
import { useGetInventoryItem } from "../inventory/useGetInventoryItem";
import { EditInventoryItemDialog } from "../inventory/EditInventoryItemDialog";
import { DeleteInventoryItemDialog } from "../inventory/DeleteInventoryItemDialog";
import { useReportFormatting } from "../reports/reportFormatting";
import { useGetWarehouses } from "../warehouses/useGetWarehouses";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { SupplierDeliveryDialog } from "./SupplierDeliveryDialog";
import { inventoryListPath } from "./supplierRoutes";
import { useSupplierDeliveries, useSupplierParts } from "./useSupplierDeliveries";

type TabKey = "deliveries" | "parts";

export function SupplierPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { locale = "en", workspaceId = "", supplierName: encodedName = "" } = useParams();
  const supplierName = decodeURIComponent(encodedName).trim();
  const inventoryPath = inventoryListPath(locale, workspaceId);

  const { formatMoney } = useWorkspaceMoney();
  const { formatDate } = useReportFormatting();
  const { data: warehouses = [] } = useGetWarehouses();
  const warehouseNameById = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name])),
    [warehouses],
  );

  const deliveriesQuery = useSupplierDeliveries(supplierName);
  const partsQuery = useSupplierParts(supplierName);

  const deliveries = useMemo(
    () => deliveriesQuery.data?.pages.flatMap((page) => page.rows) ?? [],
    [deliveriesQuery.data],
  );
  const parts = partsQuery.data ?? [];
  // Summary is computed server-side over the full merged list; first page carries it.
  const deliveriesSummary = deliveriesQuery.data?.pages[0];
  const deliveriesCount = deliveriesSummary?.totalCount ?? 0;
  const totalAmount = deliveriesSummary?.postedTotal ?? 0;
  const lastDeliveryDate = deliveriesSummary?.lastDeliveryAt
    ? financeDateKey(deliveriesSummary.lastDeliveryAt)
    : "";

  const [tab, setTab] = useState<TabKey>("deliveries");
  const [selectedDelivery, setSelectedDelivery] = useState<SupplierDelivery | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [itemToDelete, setItemToDelete] = useState<InventoryItem | null>(null);
  const detailQuery = useGetInventoryItem(detailId);

  function warehouseLabel(warehouseId: string | null) {
    if (!warehouseId) return "—";
    return warehouseNameById.get(warehouseId) ?? t("inventory.detail.unknownWarehouse");
  }

  if (!supplierName) {
    return (
      <div className="space-y-4">
        <ErrorState title={t("suppliers.title")} description={t("common.somethingWentWrong")} />
        <Button type="button" variant="outline" onClick={() => navigate(inventoryPath)}>
          {t("suppliers.backToInventory")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          to={inventoryPath}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t("suppliers.backToInventory")}
        </Link>
        <PageHeader
          title={supplierName}
          description={t("suppliers.title")}
          aside={
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>{t("suppliers.deliveriesCount", { count: deliveriesCount })}</span>
              <span>
                {t("suppliers.totalAmount")}:{" "}
                <span className="font-medium tabular-nums text-foreground">{formatMoney(totalAmount)}</span>
              </span>
              <span>
                {t("suppliers.lastDelivery")}:{" "}
                <span className="tabular-nums text-foreground">
                  {lastDeliveryDate ? formatDate(lastDeliveryDate) : "—"}
                </span>
              </span>
              <span>{t("suppliers.partsCount", { count: parts.length })}</span>
            </div>
          }
        />
      </div>

      <div className="flex gap-1 border-b border-border">
        {(["deliveries", "parts"] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={cn(
              "px-3 py-2 text-sm font-medium transition-colors",
              tab === key
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab(key)}
          >
            {t(`suppliers.${key}`)}
          </button>
        ))}
      </div>

      {tab === "deliveries" ? (
        <DeliveriesSection
          isLoading={deliveriesQuery.isLoading}
          isError={deliveriesQuery.isError}
          onRetry={() => void deliveriesQuery.refetch()}
          deliveries={deliveries}
          isMobile={isMobile}
          formatMoney={formatMoney}
          formatDate={formatDate}
          warehouseLabel={warehouseLabel}
          hasMore={Boolean(deliveriesQuery.hasNextPage)}
          isFetchingMore={deliveriesQuery.isFetchingNextPage}
          onLoadMore={() => void deliveriesQuery.fetchNextPage()}
          onOpen={setSelectedDelivery}
        />
      ) : (
        <PartsSection
          isLoading={partsQuery.isLoading}
          isError={partsQuery.isError}
          onRetry={() => void partsQuery.refetch()}
          parts={parts}
          formatMoney={formatMoney}
          onOpen={(item) => setDetailId(item.id)}
        />
      )}

      <SupplierDeliveryDialog
        delivery={selectedDelivery}
        open={Boolean(selectedDelivery)}
        onOpenChange={(open) => {
          if (!open) setSelectedDelivery(null);
        }}
        locale={locale}
        workspaceId={workspaceId}
        warehouseName={warehouseLabel}
      />

      <InventoryDetailPanel
        item={detailQuery.item}
        open={Boolean(detailId)}
        isLoading={detailQuery.isLoading}
        isError={detailQuery.isError}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        onRetry={() => detailQuery.refetch()}
        onEdit={() => {
          if (!detailId) return;
          setEditId(detailId);
          setDetailId(null);
        }}
        onDelete={() => {
          if (!detailQuery.item) return;
          setItemToDelete(detailQuery.item);
          setDetailId(null);
        }}
      />
      <EditInventoryItemDialog itemId={editId} onClose={() => setEditId(null)} />
      <DeleteInventoryItemDialog item={itemToDelete} onClose={() => setItemToDelete(null)} />
    </div>
  );
}

function DeliveriesSection({
  isLoading,
  isError,
  onRetry,
  deliveries,
  isMobile,
  formatMoney,
  formatDate,
  warehouseLabel,
  hasMore,
  isFetchingMore,
  onLoadMore,
  onOpen,
}: {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  deliveries: SupplierDelivery[];
  isMobile: boolean;
  formatMoney: (value: number) => string;
  formatDate: (value: string) => string;
  warehouseLabel: (id: string | null) => string;
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
  onOpen: (delivery: SupplierDelivery) => void;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  if (isError) {
    return <ErrorState title={t("suppliers.deliveries")} description={t("common.somethingWentWrong")} onRetry={onRetry} />;
  }
  if (deliveries.length === 0) {
    return <EmptyState title={t("suppliers.noDeliveries")} />;
  }

  return (
    <div className="space-y-3">
      {isMobile ? (
        <ul className="space-y-2">
          {deliveries.map((delivery) => (
            <li key={delivery.id}>
              <button
                type="button"
                onClick={() => onOpen(delivery)}
                className="w-full rounded-lg border border-border bg-card p-3 text-left shadow-xs transition-colors hover:bg-accent/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium tabular-nums text-primary">
                      {delivery.number?.trim() || delivery.id.slice(0, 8)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(financeDateKey(delivery.receivedAt || delivery.createdAt))}
                      {" · "}
                      {warehouseLabel(delivery.warehouseId)}
                    </p>
                    {delivery.matchedByLegacy ? (
                      <p className="mt-1 text-xs text-muted-foreground">{t("suppliers.legacyMatchHint")}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <StatusBadge variant={delivery.status === "posted" ? "success" : "muted"}>
                      {t(`suppliers.status.${delivery.status}`)}
                    </StatusBadge>
                    <p className="mt-1 font-semibold tabular-nums">{formatMoney(delivery.total)}</p>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("suppliers.columns.date")}</th>
                <th className="px-3 py-2 font-medium">{t("suppliers.columns.number")}</th>
                <th className="px-3 py-2 font-medium">{t("suppliers.columns.warehouse")}</th>
                <th className="px-3 py-2 font-medium">{t("suppliers.columns.status")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("suppliers.columns.items")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("suppliers.columns.total")}</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr
                  key={delivery.id}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40"
                  onClick={() => onOpen(delivery)}
                >
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                    {formatDate(financeDateKey(delivery.receivedAt || delivery.createdAt))}
                    {delivery.matchedByLegacy ? (
                      <span className="mt-0.5 block text-[11px]">{t("suppliers.legacyMatchHint")}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 font-medium tabular-nums text-primary">
                    {delivery.number?.trim() || delivery.id.slice(0, 8)}
                  </td>
                  <td className="px-3 py-2.5">{warehouseLabel(delivery.warehouseId)}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge variant={delivery.status === "posted" ? "success" : "muted"}>
                      {t(`suppliers.status.${delivery.status}`)}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{delivery.lines.length}</td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatMoney(delivery.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" disabled={isFetchingMore} onClick={onLoadMore}>
            {isFetchingMore ? <Spinner className="size-4" /> : null}
            {t("suppliers.loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PartsSection({
  isLoading,
  isError,
  onRetry,
  parts,
  formatMoney,
  onOpen,
}: {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  parts: InventoryItem[];
  formatMoney: (value: number | null) => string;
  onOpen: (item: InventoryItem) => void;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  if (isError) {
    return <ErrorState title={t("suppliers.parts")} description={t("common.somethingWentWrong")} onRetry={onRetry} />;
  }
  if (parts.length === 0) {
    return <EmptyState title={t("suppliers.noParts")} />;
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {parts.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-foreground">{item.name}</span>
              {item.sku ? <span className="block truncate font-mono text-xs text-muted-foreground">{item.sku}</span> : null}
            </span>
            <span className="shrink-0 text-right text-sm">
              <span className="block font-medium tabular-nums">{formatMoney(item.purchasePrice)}</span>
              <span className="block text-xs text-muted-foreground tabular-nums">
                {item.quantity} {item.unit}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
