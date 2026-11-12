import { memo, useMemo, type ReactNode } from "react";
import { materialRowPropsEqual } from "./lineRowMemo";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import type { Order, OrderMaterial } from "../../../lib/types";
import { formatQuantity } from "../../../lib/quantity";
import { StatusBadge } from "../../../ui/StatusBadge";
import { vatIncludedAmount } from "../../finance/vat";
import {
  isCatalogOrderMaterial,
  resolveMaterialSupplySource,
} from "../../inventory/orderMaterialLine";
import {
  materialIssued,
  materialReturned,
  netOutsideWarehouse,
  remainingToIssue,
  warehouseMaterialStatus,
  warehouseStatusBadgeVariant,
} from "../../inventory/warehouseMaterialStatus";
import { orderLineAmount } from "../../services/orderServiceLine";
import { resolveCatalogLineStockLimit } from "../catalogMaterialStockLimit";
import { OrderLineDeleteButton } from "../OrderLineDeleteButton";
import { OrderLineEditButton } from "../OrderLineEditButton";
import { OrderLineWarrantyBadge } from "../OrderLineWarrantyBadge";
import OrderMaterialLineInlineCells, {
  type MaterialLineInlineEditTarget,
  type MaterialLineInlineField,
} from "../OrderMaterialLineInlineCells";

export type OrderMaterialLineRowProps = {
  line: OrderMaterial;
  order: Order;
  isEditingPrice: boolean;
  isEditingQty: boolean;
  showFieldEdit: boolean;
  canWarehouse: boolean;
  showWarrantyKm: boolean;
  formatMoney: (value: number) => string;
  locale: string;
  detailVatRate: number | null;
  materialSourceCustomer: string;
  warehouseName?: string;
  purchasePrice?: number;
  warehouseStock: Parameters<typeof resolveCatalogLineStockLimit>[0]["stock"];
  saving: boolean;
  deletePending: boolean;
  onOpenCatalog: (inventoryItemId: string) => void;
  onRequestEdit: (lineId: string, field: MaterialLineInlineField) => void;
  onCancelEdit: () => void;
  onSavedEdit: () => void;
  onSaveField: (lineId: string, field: MaterialLineInlineField, raw: string) => Promise<void>;
  onDelete: (lineId: string) => void;
  /** Opens the single-line edit dialog (pencil). Stable callback; only the line id is passed. */
  onEditLine: (lineId: string) => void;
  onEditorClosed: () => void;
};

function OrderMaterialLineRowComponent({
  line,
  order,
  isEditingPrice,
  isEditingQty,
  showFieldEdit,
  canWarehouse,
  showWarrantyKm,
  formatMoney,
  locale,
  detailVatRate,
  materialSourceCustomer,
  warehouseName,
  purchasePrice,
  warehouseStock,
  saving,
  deletePending,
  onOpenCatalog,
  onRequestEdit,
  onCancelEdit,
  onSavedEdit,
  onSaveField,
  onDelete,
  onEditLine,
  onEditorClosed,
}: OrderMaterialLineRowProps) {
  const { t } = useTranslation();
  const catalog = isCatalogOrderMaterial(line);
  const source = resolveMaterialSupplySource(line);
  const sourceLabel =
    source === "customer"
      ? materialSourceCustomer
      : source === "one_time"
        ? t("orders.form.materialSourceOneTime")
        : t("orders.form.materialSourceCatalog");
  const status = catalog ? warehouseMaterialStatus(line) : null;
  const lineId = line.id?.trim() ?? "";
  const lineGross = useMemo(
    () => orderLineAmount({ price: line.price, quantity: line.quantity }),
    [line.price, line.quantity],
  );
  const lineVat = useMemo(
    () => (detailVatRate != null ? vatIncludedAmount(lineGross, detailVatRate) : null),
    [detailVatRate, lineGross],
  );

  const stockLimit = useMemo(() => {
    if (!isCatalogOrderMaterial(line) || !line.warehouseId || !line.inventoryItemId) return null;
    return resolveCatalogLineStockLimit({
      line,
      lines: order.materials ?? [],
      stock: warehouseStock,
      exclude: { lineId: line.id },
    });
  }, [line, order.materials, warehouseStock]);

  const editing: MaterialLineInlineEditTarget | null = isEditingPrice
    ? { lineId, field: "price" }
    : isEditingQty
      ? { lineId, field: "quantity" }
      : null;

  const amountNode: ReactNode = (
    <>
      <div>{formatMoney(lineGross)}</div>
      {lineVat != null ? (
        <div className="text-[11px] text-muted-foreground">
          {t("orders.vat.included")}: {formatMoney(lineVat)}
        </div>
      ) : null}
    </>
  );

  return (
    <tr>
      <td className="px-2 py-2 [overflow-wrap:anywhere] text-foreground sm:px-3">
        <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <p>
              {catalog && line.inventoryItemId ? (
                <button
                  type="button"
                  className="text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none [overflow-wrap:anywhere]"
                  onClick={() => onOpenCatalog(line.inventoryItemId!)}
                  title={t("orders.catalogLink.openMaterial")}
                >
                  {line.itemName}
                </button>
              ) : (
                line.itemName
              )}
            </p>
            <OrderLineWarrantyBadge
              activated={Boolean(order.closedAt)}
              status={order.closedAt && order.status !== "closed" ? "paused" : undefined}
              startsAt={order.closedAt}
              mileageUnit={order.vehicleMileageUnitSnapshot ?? "km"}
              showWarrantyKm={showWarrantyKm}
              limits={{
                durationMonths: line.warrantyMonths ?? null,
                durationDays: line.warrantyDays ?? null,
                mileageLimit: line.warrantyKm ?? null,
              }}
            />
            <p className="text-[11px] text-muted-foreground">{sourceLabel}</p>
            {status ? (
              <>
                <StatusBadge variant={warehouseStatusBadgeVariant(status)}>
                  {t(`orders.warehouse.status.${status}`)}
                </StatusBadge>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {t("orders.warehouse.fulfillmentSummary", {
                    issued: formatQuantity(materialIssued(line), locale),
                    returned: formatQuantity(materialReturned(line), locale),
                    remaining: formatQuantity(remainingToIssue(line), locale),
                    net: formatQuantity(netOutsideWarehouse(line), locale),
                  })}
                </p>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">{t("orders.form.freeformNoStockImpact")}</p>
            )}
          </div>
          {showFieldEdit && lineId && (!catalog || canWarehouse) ? (
            <div className="flex shrink-0 items-center self-end sm:-my-2.5 sm:self-start">
              <OrderLineEditButton
                testId={`material-line-edit-${lineId}`}
                // Not tied to background saves: the dialog always opens with the current line, and the row
                // deliberately skips re-rendering on the shared «saving» flag (lineRowMemo).
                disabled={deletePending}
                onClick={() => onEditLine(lineId)}
              />
              <OrderLineDeleteButton
                testId={`material-line-delete-${lineId}`}
                disabled={deletePending}
                onClick={() => void onDelete(lineId)}
              />
            </div>
          ) : null}
        </div>
      </td>
      <OrderMaterialLineInlineCells
        line={line}
        editable={showFieldEdit}
        editing={editing}
        formatMoney={formatMoney}
        locale={locale}
        saving={saving}
        purchasePrice={purchasePrice}
        warehouseName={warehouseName}
        warehouseOnHand={stockLimit?.warehouseOnHand ?? null}
        maxQuantity={stockLimit?.max ?? null}
        amountNode={amountNode}
        onRequestEdit={(field) => {
          if (!lineId) return;
          onRequestEdit(lineId, field);
        }}
        onCancel={onCancelEdit}
        onSaved={onSavedEdit}
        onSaveField={async (field, raw) => {
          if (!lineId) return;
          await onSaveField(lineId, field, raw);
        }}
        onEditorClosed={onEditorClosed}
        onSetQuantityToMax={(max) => {
          if (!lineId) return;
          void onSaveField(lineId, "quantity", String(max))
            .then(() => onSavedEdit())
            .catch((error: unknown) => {
              toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
            });
        }}
      />
    </tr>
  );
}

export const OrderMaterialLineRow = memo(OrderMaterialLineRowComponent, materialRowPropsEqual);
