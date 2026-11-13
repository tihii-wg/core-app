import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { Order, OrderMaterial } from "../../../lib/types";
import type { MaterialLineInlineField } from "../OrderMaterialLineInlineCells";
import { OrderMaterialLineRow } from "./OrderMaterialLineRow";
import type { resolveCatalogLineStockLimit } from "../catalogMaterialStockLimit";

export type OrderMaterialLinesTableProps = {
  order: Order;
  lines: OrderMaterial[];
  materialLineEditLineId: string | null;
  materialLineEditField: MaterialLineInlineField | null;
  showFieldEdit: boolean;
  canWarehouse: boolean;
  showWarrantyKm: boolean;
  formatMoney: (value: number) => string;
  locale: string;
  detailVatRate: number | null;
  materialSourceCustomer: string;
  warehouseNameById: Map<string, string>;
  purchasePriceById: Map<string, number>;
  warehouseStock: Parameters<typeof resolveCatalogLineStockLimit>[0]["stock"];
  saving: boolean;
  deletePending: boolean;
  commentsVisible: boolean;
  commentsEditable: boolean;
  commentSaving?: boolean;
  onSaveComment: (lineId: string, body: string | null) => Promise<void>;
  onOpenCatalog: (inventoryItemId: string) => void;
  onRequestEdit: (lineId: string, field: MaterialLineInlineField) => void;
  onCancelEdit: () => void;
  onSavedEdit: () => void;
  onSaveField: (lineId: string, field: MaterialLineInlineField, raw: string) => Promise<void>;
  onDelete: (lineId: string) => void;
  onEditLine: (lineId: string) => void;
  onEditorClosed: () => void;
};

function OrderMaterialLinesTableComponent({
  order,
  lines,
  materialLineEditLineId,
  materialLineEditField,
  showFieldEdit,
  canWarehouse,
  showWarrantyKm,
  formatMoney,
  locale,
  detailVatRate,
  materialSourceCustomer,
  warehouseNameById,
  purchasePriceById,
  warehouseStock,
  saving,
  deletePending,
  commentsVisible,
  commentsEditable,
  commentSaving = false,
  onSaveComment,
  onOpenCatalog,
  onRequestEdit,
  onCancelEdit,
  onSavedEdit,
  onSaveField,
  onDelete,
  onEditLine,
  onEditorClosed,
}: OrderMaterialLinesTableProps) {
  const { t } = useTranslation();
  const editingQuantity = materialLineEditField === "quantity";

  return (
    <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-border">
      {/* Fixed layout only from sm: on phones the auto layout keeps the money cells readable. */}
      <table className="w-full text-sm sm:table-fixed">
        {/* The open quantity editor carries the stock hint / warning: give that column more room. */}
        {editingQuantity ? (
          <colgroup>
            <col className="w-[32%]" />
            <col className="w-[34%]" />
            <col className="w-[17%]" />
            <col className="w-[17%]" />
          </colgroup>
        ) : (
          <colgroup>
            <col className="w-[50%]" />
            <col className="w-[12%]" />
            <col className="w-[19%]" />
            <col className="w-[19%]" />
          </colgroup>
        )}
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="px-2 py-2 text-left font-medium sm:px-3">{t("orders.detail.materials")}</th>
            <th className="px-2 py-2 text-right font-medium sm:px-3">{t("orders.detail.quantity")}</th>
            <th className="px-2 py-2 text-right font-medium sm:px-3">{t("orders.detail.price")}</th>
            <th className="px-2 py-2 text-right font-medium sm:px-3">{t("orders.detail.amount")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lines.map((line, index) => {
            const lineId = line.id?.trim() ?? "";
            return (
              <OrderMaterialLineRow
                key={line.id ?? `${line.inventoryItemId ?? "free"}-${index}`}
                line={line}
                order={order}
                isEditingPrice={Boolean(lineId && materialLineEditLineId === lineId && materialLineEditField === "price")}
                isEditingQty={Boolean(lineId && materialLineEditLineId === lineId && materialLineEditField === "quantity")}
                showFieldEdit={showFieldEdit}
                canWarehouse={canWarehouse}
                showWarrantyKm={showWarrantyKm}
                formatMoney={formatMoney}
                locale={locale}
                detailVatRate={detailVatRate}
                materialSourceCustomer={materialSourceCustomer}
                warehouseName={line.warehouseId ? warehouseNameById.get(line.warehouseId) : undefined}
                purchasePrice={line.inventoryItemId ? purchasePriceById.get(line.inventoryItemId) : undefined}
                warehouseStock={warehouseStock}
                saving={saving}
                deletePending={deletePending}
                commentsVisible={commentsVisible}
                commentsEditable={commentsEditable}
                commentSaving={commentSaving}
                onSaveComment={onSaveComment}
                onOpenCatalog={onOpenCatalog}
                onRequestEdit={onRequestEdit}
                onCancelEdit={onCancelEdit}
                onSavedEdit={onSavedEdit}
                onSaveField={onSaveField}
                onDelete={onDelete}
                onEditLine={onEditLine}
                onEditorClosed={onEditorClosed}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const OrderMaterialLinesTable = memo(OrderMaterialLinesTableComponent);
