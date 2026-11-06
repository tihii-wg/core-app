import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/Dialog";
import type { SupplierDelivery } from "../../services/apiWarehouseOps";
import { financeDateKey } from "../finance/financeStats";
import { useReportFormatting } from "../reports/reportFormatting";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { inventoryItemPath } from "./supplierRoutes";

type SupplierDeliveryDialogProps = {
  delivery: SupplierDelivery | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
  workspaceId: string;
  warehouseName: (warehouseId: string | null) => string;
};

export function SupplierDeliveryDialog({
  delivery,
  open,
  onOpenChange,
  locale,
  workspaceId,
  warehouseName,
}: SupplierDeliveryDialogProps) {
  const { t } = useTranslation();
  const { formatMoney } = useWorkspaceMoney();
  const { formatDate } = useReportFormatting();

  const numberLabel = delivery?.number?.trim() || delivery?.id.slice(0, 8) || "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("suppliers.deliveryTitle", { number: numberLabel })}</DialogTitle>
          <DialogDescription className="sr-only">{t("suppliers.deliveryTitle", { number: numberLabel })}</DialogDescription>
        </DialogHeader>

        {delivery ? (
          <div className="space-y-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t("suppliers.columns.date")}</dt>
                <dd className="font-medium tabular-nums">
                  {formatDate(financeDateKey(delivery.receivedAt || delivery.createdAt)) || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("suppliers.columns.warehouse")}</dt>
                <dd className="font-medium">{warehouseName(delivery.warehouseId)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("suppliers.columns.status")}</dt>
                <dd className="font-medium">{t(`suppliers.status.${delivery.status}`)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("suppliers.supplierField")}</dt>
                <dd className="font-medium [overflow-wrap:anywhere]">
                  {delivery.supplierName || "—"}
                  {delivery.matchedByLegacy ? (
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {t("suppliers.legacyMatchHint")}
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>

            {delivery.comment ? (
              <div className="text-sm">
                <p className="text-muted-foreground">{t("suppliers.detail.comment")}</p>
                <p className="mt-0.5 [overflow-wrap:anywhere]">{delivery.comment}</p>
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-sm font-medium">{t("suppliers.detail.lines")}</p>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {delivery.lines.map((line) => (
                  <li key={line.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      {line.inventoryItemId ? (
                        <Link
                          to={inventoryItemPath(locale, workspaceId, line.inventoryItemId)}
                          className="font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {line.itemName || t("suppliers.detail.openPart")}
                        </Link>
                      ) : (
                        <span className="font-medium">{line.itemName || "—"}</span>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                        {t("suppliers.detail.quantity")}: {line.quantity}
                        {" · "}
                        {t("suppliers.detail.unitCost")}: {formatMoney(line.unitCost)}
                      </p>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums">{formatMoney(line.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-right text-sm font-semibold tabular-nums">
                {t("suppliers.columns.total")}: {formatMoney(delivery.total)}
              </p>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
