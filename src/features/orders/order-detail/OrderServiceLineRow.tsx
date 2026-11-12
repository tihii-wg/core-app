import { memo, useMemo, type ReactNode } from "react";
import { serviceRowPropsEqual } from "./lineRowMemo";
import { useTranslation } from "react-i18next";
import type { Order, OrderService } from "../../../lib/types";
import { cn } from "../../../lib/utils";
import { StatusBadge } from "../../../ui/StatusBadge";
import { vatIncludedAmount } from "../../finance/vat";
import type { AssignableTechnician } from "../assignableTechnicians";
import { OrderLineDeleteButton } from "../OrderLineDeleteButton";
import { OrderLineWarrantyBadge } from "../OrderLineWarrantyBadge";
import OrderServiceLineInlineCells, {
  OrderServiceLinePerformerInline,
  type ServiceLineInlineEditTarget,
  type ServiceLineInlineField,
} from "../OrderServiceLineInlineCells";
import { orderLineAmount } from "../../services/orderServiceLine";

export type OrderServiceLineRowProps = {
  line: OrderService;
  order: Order;
  isHighlighted: boolean;
  isEditingPrice: boolean;
  isEditingQty: boolean;
  isEditingPerformer: boolean;
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

function OrderServiceLineRowComponent({
  line,
  order,
  isHighlighted,
  isEditingPrice,
  isEditingQty,
  isEditingPerformer,
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
}: OrderServiceLineRowProps) {
  const { t } = useTranslation();
  const lineId = line.id?.trim() ?? "";
  const lineGross = useMemo(
    () => orderLineAmount({ price: line.price, quantity: line.quantity }),
    [line.price, line.quantity],
  );
  const lineVat = useMemo(
    () => (detailVatRate != null ? vatIncludedAmount(lineGross, detailVatRate) : null),
    [detailVatRate, lineGross],
  );

  const editing: ServiceLineInlineEditTarget | null = isEditingPrice
    ? { lineId, field: "price" }
    : isEditingQty
      ? { lineId, field: "quantity" }
      : isEditingPerformer
      ? { lineId, field: "performer" }
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
    <tr
      data-order-service-line-id={line.serviceId || undefined}
      data-order-service-line-row={lineId || undefined}
      className={cn(isHighlighted && "bg-primary/10 ring-1 ring-inset ring-primary/40")}
    >
      <td className="px-2 py-2 [overflow-wrap:anywhere] text-foreground sm:px-3">
        <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:justify-between">
          <div className="min-w-0 flex-1 space-y-0.5">
            <p>
              {canOpenServiceForm && line.serviceId ? (
                <button
                  type="button"
                  className="text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none [overflow-wrap:anywhere]"
                  onClick={() => onOpenCatalog(line.serviceId)}
                  title={t("orders.catalogLink.openService")}
                >
                  {line.serviceName}
                </button>
              ) : (
                line.serviceName
              )}
              {line.kind ? (
                <StatusBadge variant="muted" className="ml-2 align-middle">
                  {t(`orders.form.lineKind.${line.kind}`)}
                </StatusBadge>
              ) : null}
            </p>
            <OrderServiceLinePerformerInline
              line={line}
              editable={showFieldEdit}
              editing={editing}
              performerOptions={performerOptions}
              saving={saving}
              onRequestEdit={() => {
                if (!lineId) return;
                onRequestEdit(lineId, "performer");
              }}
              onCancel={onCancelEdit}
              onSaved={onSavedEdit}
              onSaveField={async (technicianId) => {
                if (!lineId) return;
                await onSaveField(lineId, "performer", technicianId);
              }}
              onEditorClosed={onEditorClosed}
            />
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
          </div>
          {canDelete && lineId ? (
            <OrderLineDeleteButton
              testId={`service-line-delete-${lineId}`}
              className="self-end sm:-my-2.5 sm:self-start"
              disabled={deletePending}
              onClick={() => void onDelete(lineId)}
            />
          ) : null}
        </div>
      </td>
      <OrderServiceLineInlineCells
        line={line}
        editable={showFieldEdit}
        editing={editing}
        formatMoney={formatMoney}
        locale={locale}
        saving={saving}
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
        onTabFromPrice={() => {
          if (!lineId) return;
          onRequestEdit(lineId, "performer");
        }}
        onEditorClosed={onEditorClosed}
      />
    </tr>
  );
}

export const OrderServiceLineRow = memo(OrderServiceLineRowComponent, serviceRowPropsEqual);
