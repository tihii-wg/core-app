import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCheck, Plus } from "lucide-react";
import { Button } from "../../ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/Card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { ErrorState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { StatusBadge } from "../../ui/StatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/Tabs";
import { formatWorkspaceMoney } from "../../lib/workspaceFormat";
import type { WarehouseOpRecord } from "../../services/apiWarehouseOps";
import { useGetWarehouseStock } from "../warehouses/useGetWarehouseStock";
import { useGetWarehouses } from "../warehouses/useGetWarehouses";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { WAREHOUSE_OP_PERMISSIONS } from "../roles/permissions";
import { useMyPermissions } from "../roles/useMyPermissions";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { useGetInventoryItems } from "./useGetInventoryItems";
import {
  useGetGoodsReceipts,
  useGetStockTransfers,
  useGetWriteOffs,
  usePostGoodsReceipt,
  usePostStockTransfer,
  usePostWriteOff,
} from "./useWarehouseOps";
import { WarehouseOpDialog } from "./WarehouseOpDialog";
import type { WarehouseOpKind } from "./warehouseOps";

const kinds: WarehouseOpKind[] = ["receipt", "transfer", "writeOff"];
const itemsSort = { field: "name", ascending: true } as const;

type OpsQuery = {
  data: { available: boolean; rows: WarehouseOpRecord[] } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => unknown;
};

function formatDate(value: string, language: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(language);
}

/** Inventory → Operations: goods receipts, stock transfers and write-offs (drafts are posted via server RPCs). */
export function WarehouseOpsPanel() {
  const { t, i18n } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const { canWrite } = useWorkspaceSubscription();
  const { can } = useMyPermissions();
  const canCreate = (kind: WarehouseOpKind) => can(WAREHOUSE_OP_PERMISSIONS[kind].create);
  // Post RPCs accept create OR edit permission.
  const canPost = (kind: WarehouseOpKind) => canCreate(kind) || can(WAREHOUSE_OP_PERMISSIONS[kind].edit);

  const [tab, setTab] = useState<WarehouseOpKind>("receipt");
  const [createKind, setCreateKind] = useState<WarehouseOpKind | null>(null);
  const [toPost, setToPost] = useState<WarehouseOpRecord | null>(null);

  const receipts = useGetGoodsReceipts();
  const transfers = useGetStockTransfers();
  const writeOffs = useGetWriteOffs();
  const warehousesQuery = useGetWarehouses();
  const stockQuery = useGetWarehouseStock();
  const { items } = useGetInventoryItems("", "all", itemsSort);

  const postReceipt = usePostGoodsReceipt();
  const postTransfer = usePostStockTransfer();
  const postWriteOff = usePostWriteOff();

  const queries: Record<WarehouseOpKind, OpsQuery> = {
    receipt: receipts as OpsQuery,
    transfer: transfers as OpsQuery,
    writeOff: writeOffs as OpsQuery,
  };
  const posting = { receipt: postReceipt, transfer: postTransfer, writeOff: postWriteOff }[toPost?.kind ?? "receipt"];

  const warehouseNames = useMemo(
    () => new Map((warehousesQuery.data ?? []).map((warehouse) => [warehouse.id, warehouse.name])),
    [warehousesQuery.data],
  );
  const formatMoney = (value: number) => formatWorkspaceMoney(value, workspace?.currency);
  const warehouseName = (id: string | null) => (id ? (warehouseNames.get(id) ?? t("inventory.ops.unknownWarehouse")) : "—");

  function whereLabel(op: WarehouseOpRecord) {
    return op.kind === "transfer"
      ? `${warehouseName(op.fromWarehouseId)} → ${warehouseName(op.toWarehouseId)}`
      : warehouseName(op.warehouseId);
  }

  function confirmPost() {
    if (!toPost) return;
    posting.mutate(toPost.id, { onSettled: () => setToPost(null) });
  }

  function renderList(kind: WarehouseOpKind) {
    const query = queries[kind];
    if (query.isLoading) {
      return (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      );
    }
    if (query.isError) {
      return (
        <ErrorState
          title={t("inventory.ops.loadError.title")}
          description={t("inventory.ops.loadError.description")}
          onRetry={() => query.refetch()}
        />
      );
    }
    if (!query.data?.available) {
      return (
        <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t("inventory.ops.unavailable")}
        </p>
      );
    }
    const rows = query.data.rows;
    if (rows.length === 0) {
      return (
        <div className="py-6 text-center">
          <p className="text-sm font-medium text-foreground">{t(`inventory.ops.${kind}.emptyTitle`)}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t(`inventory.ops.${kind}.emptyDescription`)}</p>
        </div>
      );
    }
    return (
      <ul className="divide-y divide-border rounded-lg border border-border">
        {rows.map((op) => {
          const summary = op.lines.map((line) => `${line.itemName} × ${line.quantity}`).join(", ");
          return (
            <li key={op.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{op.number ?? `#${op.id.slice(0, 8)}`}</span>
                  <StatusBadge variant={op.posted ? "success" : "warning"} dot>
                    {t(op.posted ? "inventory.ops.status.posted" : "inventory.ops.status.draft")}
                  </StatusBadge>
                  <span className="text-xs text-muted-foreground">{formatDate(op.createdAt, i18n.language)}</span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{whereLabel(op)}</p>
                <p className="truncate text-xs text-muted-foreground" title={summary}>
                  {summary || t("inventory.ops.noLinesShort")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-medium tabular-nums">{formatMoney(op.total)}</span>
                {!op.posted && canWrite && canPost(op.kind) ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setToPost(op)}>
                    <CheckCheck />
                    {t("inventory.ops.post")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  const activeAvailable = queries[tab].data?.available ?? false;

  return (
    <Card>
      <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>{t("inventory.ops.title")}</CardTitle>
          <CardDescription>{t("inventory.ops.description")}</CardDescription>
        </div>
        {canWrite && activeAvailable && canCreate(tab) ? (
          <Button type="button" size="sm" onClick={() => setCreateKind(tab)}>
            <Plus />
            {t(`inventory.ops.${tab}.create`)}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(value) => setTab(value as WarehouseOpKind)}>
          <TabsList>
            {kinds.map((kind) => (
              <TabsTrigger key={kind} value={kind}>
                {t(`inventory.ops.${kind}.tab`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {kinds.map((kind) => (
            <TabsContent key={kind} value={kind} className="pt-2">
              {renderList(kind)}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>

      {createKind ? (
        <WarehouseOpDialog
          kind={createKind}
          open
          onOpenChange={(open) => {
            if (!open) setCreateKind(null);
          }}
          warehouses={warehousesQuery.data ?? []}
          items={items}
          stock={stockQuery.data ?? []}
          formatMoney={formatMoney}
        />
      ) : null}

      <Dialog
        open={Boolean(toPost)}
        onOpenChange={(open) => {
          if (!open && !posting.isPending) setToPost(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("inventory.ops.postDialog.title")}</DialogTitle>
            <DialogDescription>{toPost ? t(`inventory.ops.${toPost.kind}.postDescription`) : ""}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setToPost(null)} disabled={posting.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={confirmPost} disabled={posting.isPending}>
              {posting.isPending ? t("inventory.ops.posting") : t("inventory.ops.post")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
