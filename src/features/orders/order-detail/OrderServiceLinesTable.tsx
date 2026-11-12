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
  onOpenCatalog: (serviceId: string) => void;
  onRequestEdit: (lineId: string, field: ServiceLineInlineField) => void;
  onCancelEdit: () => void;
  onSavedEdit: () => void;
  onSaveField: (lineId: string, field: ServiceLineInlineField, raw: string) => Promise<void>;
  onDelete: (lineId: string) => void;
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
  onOpenCatalog,
  onRequestEdit,
  onCancelEdit,
  onSavedEdit,
  onSaveField,
  onDelete,
  onEditorClosed,
}: OrderServiceLinesTableProps) {
  const { t } = useTranslation();

  return (
    <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-border">
      <table className="w-full text-sm sm:table-fixed">
        <colgroup>
          <col className="w-[42%]" />
          <col className="w-[16%]" />
          <col className="w-[22%]" />
          <col className="w-[20%]" />
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
                onOpenCatalog={onOpenCatalog}
                onRequestEdit={onRequestEdit}
                onCancelEdit={onCancelEdit}
                onSavedEdit={onSavedEdit}
                onSaveField={onSaveField}
                onDelete={onDelete}
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
