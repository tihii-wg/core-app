import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { Button } from "../../ui/Button";
import { InventoryStatusBadge, StatusBadge } from "../../ui/StatusBadge";
import { Spinner } from "../../ui/Spinner";
import type { InventoryItem, InventoryMovementType } from "../../lib/types";
import { industryInventoryCopy } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { formatWorkspaceDate, formatWorkspaceMoney } from "../../lib/workspaceFormat";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useInventoryMovements } from "./useInventoryMovements";

type InventoryDetailPanelProps = {
  item: InventoryItem | null;
  open: boolean;
  isLoading: boolean;
  isError: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onRetry: () => void;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-[13px] font-medium [overflow-wrap:anywhere] text-foreground tabular-nums">{value}</span>
    </div>
  );
}

export default function InventoryDetailPanel({ item, open, isLoading, isError, onOpenChange, onEdit, onDelete, onRetry }: InventoryDetailPanelProps) {
  const { t } = useTranslation();
  const { workflow } = useIndustryWorkflow();
  const inventoryCopy = industryInventoryCopy(workflow);
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const { data: movements = [], isLoading: movementsLoading } = useInventoryMovements(item?.id, open && Boolean(item?.id));

  function movementLabel(type: InventoryMovementType) {
    if (type === "issue") return t("inventory.detail.movementIssue");
    if (type === "return") return t("inventory.detail.movementReturn");
    return t("inventory.detail.movementAdjustment");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="[overflow-wrap:anywhere]">{item?.name ?? inventoryCopy.detailFallbackTitle}</SheetTitle>
          <SheetDescription className="sr-only">{inventoryCopy.detailDescription}</SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="flex justify-center py-12">
            <Spinner className="h-5 w-5" />
          </div>
        )}

        {isError && !isLoading && (
          <div role="alert" className="space-y-3 px-5 py-6">
            <p className="text-sm text-foreground">{t("inventory.detail.loadError")}</p>
            <Button type="button" variant="outline" onClick={onRetry}>
              {t("common.retry")}
            </Button>
          </div>
        )}

        {!isLoading && !isError && !item && open && <p className="px-5 py-6 text-sm text-muted-foreground">{t("inventory.detail.notFound")}</p>}

        {item && !isLoading && (
          <div className="space-y-5 px-5 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <InventoryStatusBadge status={item.stockStatus} />
              {item.isActive ? <StatusBadge variant="success">{t("inventory.active")}</StatusBadge> : <StatusBadge variant="muted">{t("inventory.inactive")}</StatusBadge>}
            </div>

            <div className="divide-y divide-border border-y border-border">
              {item.sku?.trim() ? <DetailRow label={t("inventory.fields.sku")} value={item.sku} /> : null}
              {item.category?.trim() ? <DetailRow label={t("inventory.fields.category")} value={item.category} /> : null}
              {item.description?.trim() ? <DetailRow label={t("inventory.fields.description")} value={item.description} /> : null}
              <DetailRow label={t("inventory.fields.quantity")} value={`${item.quantity} ${item.unit}`} />
              <DetailRow label={t("inventory.fields.minQuantity")} value={String(item.minQuantity)} />
              <DetailRow label={t("inventory.fields.unit")} value={item.unit || "—"} />
              <DetailRow label={t("inventory.fields.purchasePrice")} value={formatWorkspaceMoney(item.purchasePrice, workspace?.currency)} />
              <DetailRow label={t("inventory.fields.sellingPrice")} value={formatWorkspaceMoney(item.sellingPrice, workspace?.currency)} />
              {item.supplier?.trim() ? <DetailRow label={t("inventory.fields.supplier")} value={item.supplier} /> : null}
              {item.location?.trim() ? <DetailRow label={t("inventory.fields.location")} value={item.location} /> : null}
              <DetailRow label={t("inventory.fields.created")} value={formatWorkspaceDate(item.createdAt, workspace?.dateFormat, workspace?.timezone)} />
              <DetailRow label={t("inventory.fields.updated")} value={formatWorkspaceDate(item.updatedAt, workspace?.dateFormat, workspace?.timezone)} />
            </div>

            <div>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">{t("inventory.detail.movements")}</h3>
              {movementsLoading ? (
                <div className="flex justify-center py-4">
                  <Spinner className="h-4 w-4" />
                </div>
              ) : movements.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("inventory.detail.movementsEmpty")}</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {movements.map((movement) => {
                    const sign = movement.movementType === "return" || movement.movementType === "adjustment" ? "+" : "−";
                    return (
                      <li key={movement.id} className="flex items-start justify-between gap-3 px-3 py-2 text-[13px]">
                        <div className="min-w-0 space-y-0.5">
                          <p className="font-medium text-foreground">{movementLabel(movement.movementType)}</p>
                          <p className="text-muted-foreground tabular-nums">
                            {formatWorkspaceDate(movement.createdAt, workspace?.dateFormat, workspace?.timezone)}
                            {movement.orderId ? ` · ${movement.orderId.slice(0, 8)}` : ""}
                          </p>
                          {movement.reason ? <p className="text-muted-foreground [overflow-wrap:anywhere]">{movement.reason}</p> : null}
                        </div>
                        <span className="shrink-0 tabular-nums font-medium text-foreground">
                          {t("inventory.detail.movementQty", { sign, quantity: movement.quantity })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onEdit}>
                {t("common.edit")}
              </Button>
              <Button type="button" variant="destructive" onClick={onDelete}>
                {t("common.delete")}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
