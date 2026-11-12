import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { Order, PaymentStatus } from "../../../lib/types";
import { SheetDescription, SheetHeader, SheetTitle } from "../../../ui/Sheet";
import { OrderStatusBadge, StatusBadge } from "../../../ui/StatusBadge";
import { OrderDetailHeaderTotal } from "../OrderDetailHeaderTotal";
import { OrderDetailWarrantyUnderNumber } from "./detailHelpers";

export type OrderDetailHeaderProps = {
  selectedOrder: Order;
  isEditing: boolean;
  canEditOrder: boolean;
  closedContentLocked: boolean;
  formatMoney: (value: number) => string;
  paymentStatus: PaymentStatus;
  workspaceVatRate: number | null;
  worksLabel: string;
  materialsLabel: string;
  detailSrDescription: string;
  onStartEdit: () => void;
};

/** Header — React.memo; only receives static order props (not editing-field targets). */
function OrderDetailHeaderComponent({
  selectedOrder,
  isEditing,
  canEditOrder,
  closedContentLocked,
  formatMoney,
  paymentStatus,
  workspaceVatRate,
  worksLabel,
  materialsLabel,
  detailSrDescription,
  onStartEdit,
}: OrderDetailHeaderProps) {
  const { t } = useTranslation();

  return (
    <SheetHeader
      className={cn(
        "shrink-0 space-y-2",
        // Room for pencil + close; larger tap targets on phones (>= 44px).
        "pr-14 sm:pr-24",
        "[&_[data-slot=sheet-close]]:size-11 sm:[&_[data-slot=sheet-close]]:size-8",
      )}
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <SheetTitle className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2 tabular-nums [overflow-wrap:anywhere]">
            {selectedOrder.orderNumber}
            {!isEditing && (
              <OrderStatusBadge status={selectedOrder.status} customStatus={selectedOrder.customStatus} />
            )}
            {selectedOrder.warrantySourceOrderId && !isEditing ? (
              <StatusBadge variant="warning">{t("orders.warranty.badge")}</StatusBadge>
            ) : null}
          </span>
          {!isEditing ? <OrderDetailWarrantyUnderNumber order={selectedOrder} /> : null}
        </SheetTitle>
        {!isEditing ? (
          <OrderDetailHeaderTotal
            order={selectedOrder}
            formatMoney={formatMoney}
            paymentStatus={paymentStatus}
            workspaceVatRate={workspaceVatRate}
            worksLabel={worksLabel}
            materialsLabel={materialsLabel}
            className="w-full sm:w-auto sm:max-w-[14rem]"
          />
        ) : null}
      </div>
      {!isEditing && canEditOrder && !closedContentLocked && (
        <button
          type="button"
          onClick={onStartEdit}
          aria-label={t("common.edit")}
          title={t("orders.detail.editTitle")}
          className="absolute top-3 right-14 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 sm:top-3.5 sm:right-12 sm:size-8"
        >
          <Pencil className="size-4" />
        </button>
      )}
      <SheetDescription className="sr-only">{detailSrDescription}</SheetDescription>
    </SheetHeader>
  );
}

export const OrderDetailHeader = memo(OrderDetailHeaderComponent);
