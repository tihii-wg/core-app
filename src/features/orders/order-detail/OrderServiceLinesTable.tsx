import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { Order, OrderService } from "../../../lib/types";
import type { AssignableTechnician } from "../assignableTechnicians";
import type { ServiceLineInlineField } from "../OrderServiceLineInlineCells";
import { OrderServiceLineRow } from "./OrderServiceLineRow";

export type OrderServiceLinesTableProps = {
  order: Order;
  lines: OrderService[];
  highlightedServiceId: string | null;
  serviceLineEditLineId: string | null;
  serviceLineEditField: ServiceLineInlineField | null;
  showFieldEdit: boolean;
  canDelete: boolean;
  canOpenServiceForm: boolean;
  showWarrantyKm: boolean;
  formatMoney: (value: number) => string;
  locale: string;
  detailVatRate: number | null;
  performerOptions: AssignableTechnician[];
  saving: boolean;
  deletePending: boolean;
  commentsVisible: boolean;
  commentsEditable: boolean;
  commentSaving?: boolean;
  onSaveComment: (lineId: string, body: string | null) => Promise<void>;
  onOpenCatalog: (serviceId: string) => void;
  onRequestEdit: (lineId: string, field: ServiceLineInlineField) => void;
  onCancelEdit: () => void;
  onSavedEdit: () => void;
  onSaveField: (lineId: string, field: ServiceLineInlineField, raw: string) => Promise<void>;
  onDelete: (lineId: string) => void;
  onEditLine: (lineId: string) => void;
  onEditorClosed: () => void;
};

function OrderServiceLinesTableComponent({
  order,
  lines,
  highlightedServiceId,
  serviceLineEditLineId,
  serviceLineEditField,
  showFieldEdit,
  canDelete,
  canOpenServiceForm,
  showWarrantyKm,
  formatMoney,
  locale,
  detailVatRate,
  performerOptions,
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
}: OrderServiceLinesTableProps) {
  const { t } = useTranslation();

  return (
    <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-border">
      <table className="w-full text-sm sm:table-fixed">
        <colgroup>
          <col className="w-[50%]" />
          <col className="w-[12%]" />
          <col className="w-[19%]" />
          <col className="w-[19%]" />
        </colgroup>
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="px-2 py-2 text-left font-medium sm:px-3">{t("orders.detail.services")}</th>
            <th className="px-2 py-2 text-right font-medium sm:px-3">{t("orders.detail.quantity")}</th>
            <th className="px-2 py-2 text-right font-medium sm:px-3">{t("orders.detail.price")}</th>
            <th className="px-2 py-2 text-right font-medium sm:px-3">{t("orders.detail.amount")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lines.map((line, index) => {
            const lineId = line.id?.trim() ?? "";
            return (
              <OrderServiceLineRow
                key={line.id ?? `${line.serviceId}-${index}`}
                line={line}
                order={order}
                isHighlighted={Boolean(line.serviceId && highlightedServiceId === line.serviceId)}
                isEditingPrice={Boolean(lineId && serviceLineEditLineId === lineId && serviceLineEditField === "price")}
                isEditingQty={Boolean(lineId && serviceLineEditLineId === lineId && serviceLineEditField === "quantity")}
                isEditingPerformer={Boolean(
                  lineId && serviceLineEditLineId === lineId && serviceLineEditField === "performer",
                )}
                showFieldEdit={showFieldEdit}
                canDelete={canDelete}
                canOpenServiceForm={canOpenServiceForm}
                showWarrantyKm={showWarrantyKm}
                formatMoney={formatMoney}
                locale={locale}
                detailVatRate={detailVatRate}
                performerOptions={performerOptions}
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

export const OrderServiceLinesTable = memo(OrderServiceLinesTableComponent);
