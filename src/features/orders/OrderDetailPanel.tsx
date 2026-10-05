import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Pencil } from "lucide-react";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { OrderStatusBadge, PaymentStatusBadge } from "../../ui/StatusBadge";
import type { Order, OrderStatus } from "../../lib/types";
import EditOrderForm from "./EditOrderForm";
import ClientTypeBadge from "../clients/ClientTypeBadge";
import useGetEmployees from "../employees/useGetEmployees";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";

type OrderDetailPanelProps = {
  selectedOrder: Order | null;
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
  // employees: Employee[];
  onOrderUpdated: (order: Order) => void;
  onStatusChange: (status: OrderStatus) => void;
};

const orderStatuses: OrderStatus[] = ["new", "in-progress", "waiting-parts", "completed", "paid", "cancelled"];

export default function OrderDetailPanel({ selectedOrder, detailPanelOpen, setDetailPanelOpen, onOrderUpdated, onStatusChange }: OrderDetailPanelProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState(selectedOrder?.id);
  const { employees,} = useGetEmployees();
  const { formatMoney } = useWorkspaceMoney();


  if (selectedOrder?.id !== editingOrderId) {
    setEditingOrderId(selectedOrder?.id);
    setIsEditing(false);
  }

  function handleOpenChange(open: boolean) {
    setDetailPanelOpen(open);
    if (!open) setIsEditing(false);
  }

  return (
    <Sheet open={detailPanelOpen} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-24">
          <SheetTitle className="flex min-w-0 flex-wrap items-center gap-2 tabular-nums">
            {selectedOrder?.orderNumber}
            {selectedOrder && !isEditing && <OrderStatusBadge status={selectedOrder.status} />}
          </SheetTitle>
          {selectedOrder && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              aria-label={t("common.edit")}
              title={t("orders.detail.editTitle")}
              className="absolute top-3.5 right-12 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35"
            >
              <Pencil className="size-4" />
            </button>
          )}
          <SheetDescription className="sr-only">{t("orders.detail.srDescription")}</SheetDescription>
        </SheetHeader>

        {selectedOrder && isEditing && (
          <div className="px-5 py-5">
            <EditOrderForm
              key={selectedOrder.id}
              order={selectedOrder}
              employees={employees ?? []}
              onCancel={() => setIsEditing(false)}
              onUpdated={(order) => {
                onOrderUpdated(order);
                setIsEditing(false);
                setDetailPanelOpen(false);
              }}
            />
          </div>
        )}

        {selectedOrder && !isEditing && (
          <div className="space-y-5 px-5 py-5">
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/50 p-4">
              <div className="min-w-0">
                <h3 className="text-xs font-medium text-muted-foreground">{t("orders.detail.client")}</h3>
                <p className="mt-1 font-medium [overflow-wrap:anywhere] text-foreground">{selectedOrder.clientName}</p>
                <div className="mt-3">
                  <h3 className="text-xs font-medium text-muted-foreground">{t("orders.detail.clientType")}</h3>
                  <div className="mt-1">
                    {selectedOrder.clientType ? <ClientTypeBadge clientType={selectedOrder.clientType} /> : <span className="text-subtle-foreground">—</span>}
                  </div>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <h3 className="text-xs font-medium text-muted-foreground">{t("orders.detail.totalPrice")}</h3>
                <p className="mt-1 text-xl font-semibold tracking-tight text-foreground tabular-nums">{formatMoney(selectedOrder.totalPrice)}</p>
                <div className="mt-2">
                  <PaymentStatusBadge status={selectedOrder.paymentStatus} />
                </div>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
              <DetailItem label={t("orders.detail.device")} value={selectedOrder.device} />
              <DetailItem label={t("orders.detail.service")} value={selectedOrder.service} />
              <DetailItem label={t("orders.detail.carNumber")} value={selectedOrder.carNumber} />
              <DetailItem label={t("orders.detail.vin")} value={selectedOrder.vin} mono />
              <DetailItem label={t("orders.detail.assignedTo")} value={selectedOrder.assignedEmployeeName} />
              <DetailItem
                label={t("orders.detail.deadline")}
                value={
                  selectedOrder.deadline ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="size-3.5 text-subtle-foreground" />
                      {selectedOrder.deadline}
                    </span>
                  ) : null
                }
              />
              <div className="col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">{t("orders.detail.description")}</dt>
                <dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground">{selectedOrder.description || <span className="text-subtle-foreground">—</span>}</dd>
              </div>
            </dl>

            <div className="border-t border-border pt-5">
              <Label htmlFor="order-status" className="mb-2 block">{t("orders.detail.updateStatus")}</Label>
              <Select value={selectedOrder.status} onValueChange={onStatusChange as (value: string) => void}>
                <SelectTrigger id="order-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {orderStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {t(`status.order.${status}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle-foreground tabular-nums">
              <p>{t("orders.detail.created", { date: selectedOrder.createdAt })}</p>
              <p>{t("orders.detail.updated", { date: selectedOrder.updatedAt })}</p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailItem({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-1 font-mono text-[13px] [overflow-wrap:anywhere] text-foreground" : "mt-1 font-medium [overflow-wrap:anywhere] text-foreground"}>
        {value || <span className="font-normal text-subtle-foreground">—</span>}
      </dd>
    </div>
  );
}
