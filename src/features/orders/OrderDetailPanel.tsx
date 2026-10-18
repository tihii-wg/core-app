import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Mail, Pencil, Phone } from "lucide-react";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { OrderStatusBadge, PaymentStatusBadge, StatusBadge } from "../../ui/StatusBadge";
import type { Order, OrderStatus } from "../../lib/types";
import EditOrderForm from "./EditOrderForm";
import ClientTypeBadge from "../clients/ClientTypeBadge";
import { industryOrderStatusLabel, ORDER_STATUSES, shouldShowOrderAssetValue } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import useGetEmployees from "../employees/useGetEmployees";
import { isOrderOverdue } from "./orderVisibility";
import { localDateKey } from "../../pages/dashboardStats";
import { assignableTechnicians } from "./assignableTechnicians";
import OrderAssigneeSelect from "./OrderAssigneeSelect";
import { useUpdateOrder } from "./useUpdateOrder";

type OrderDetailPanelProps = {
  selectedOrder: Order | null;
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
  onOrderUpdated: (order: Order) => void;
  onStatusChange: (status: OrderStatus) => void;
  isStatusUpdating?: boolean;
};

const orderStatuses: OrderStatus[] = ORDER_STATUSES;

export default function OrderDetailPanel({
  selectedOrder,
  detailPanelOpen,
  setDetailPanelOpen,
  onOrderUpdated,
  onStatusChange,
  isStatusUpdating = false,
}: OrderDetailPanelProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState(selectedOrder?.id);
  const { formatMoney } = useWorkspaceMoney();
  const { workflow, copy } = useIndustryWorkflow();
  const { employees, error: employeesError, isLoading: employeesLoading } = useGetEmployees();
  const { mutateAsync: updateOrder, isPending: isAssigneeUpdating } = useUpdateOrder();
  const technicianOptions = assignableTechnicians(employees, selectedOrder?.assignedEmployeeId);

  if (selectedOrder?.id !== editingOrderId) {
    setEditingOrderId(selectedOrder?.id);
    setIsEditing(false);
  }

  function handleOpenChange(open: boolean) {
    setDetailPanelOpen(open);
    if (!open) setIsEditing(false);
  }

  async function handleAssigneeChange(assignedEmployeeId: string) {
    if (!selectedOrder || isAssigneeUpdating) return;
    if ((selectedOrder.assignedEmployeeId || "") === assignedEmployeeId) return;

    try {
      const updated = await updateOrder({
        orderId: selectedOrder.id,
        device: selectedOrder.device,
        carNumber: selectedOrder.carNumber,
        vin: selectedOrder.vin,
        description: selectedOrder.description,
        assignedEmployeeId,
        deadline: selectedOrder.deadline,
      });
      onOrderUpdated(updated);
    } catch {
      return;
    }
  }

  const today = localDateKey(new Date());
  const overdue = selectedOrder ? isOrderOverdue(selectedOrder, today) : false;
  const serviceLines = selectedOrder?.services ?? [];
  const hasServiceLines = serviceLines.length > 0;
  const fallbackService = selectedOrder?.service?.trim() ?? "";
  const description = selectedOrder?.description?.trim() ?? "";
  const clientEmail = selectedOrder?.clientEmail?.trim() ?? "";
  const clientPhone = selectedOrder?.clientPhone?.trim() ?? "";
  const deadline = selectedOrder?.deadline?.trim() ?? "";
  const assigneeEmptyHint =
    !employeesError && !employeesLoading && employees && technicianOptions.length === 0
      ? t("orders.form.noLinkedTechnicians")
      : null;
  const assigneeErrorMessage =
    employeesError instanceof Error ? employeesError.message : employeesError ? t("orders.form.techniciansLoadFailed") : null;

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
          <SheetDescription className="sr-only">{copy.detailSrDescription}</SheetDescription>
        </SheetHeader>

        {selectedOrder && isEditing && (
          <div className="px-5 py-5">
            <EditOrderForm
              key={selectedOrder.id}
              order={selectedOrder}
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
              <div className="min-w-0 space-y-2">
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground">{t("orders.detail.client")}</h3>
                  <p className="mt-1 font-medium [overflow-wrap:anywhere] text-foreground">{selectedOrder.clientName}</p>
                </div>
                {selectedOrder.clientType ? (
                  <div>
                    <h3 className="text-xs font-medium text-muted-foreground">{t("orders.detail.clientType")}</h3>
                    <div className="mt-1">
                      <ClientTypeBadge clientType={selectedOrder.clientType} />
                    </div>
                  </div>
                ) : null}
                {(clientPhone || clientEmail) && (
                  <div className="space-y-1.5 pt-1 text-sm">
                    {clientPhone ? (
                      <div className="flex items-center gap-2">
                        <Phone className="size-3.5 shrink-0 text-subtle-foreground" />
                        <a href={`tel:${clientPhone}`} className="tabular-nums text-foreground hover:underline">
                          {clientPhone}
                        </a>
                      </div>
                    ) : null}
                    {clientEmail ? (
                      <div className="flex min-w-0 items-center gap-2">
                        <Mail className="size-3.5 shrink-0 text-subtle-foreground" />
                        <a href={`mailto:${clientEmail}`} className="truncate text-primary hover:underline">
                          {clientEmail}
                        </a>
                      </div>
                    ) : null}
                  </div>
                )}
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
              {deadline ? (
                <div className="min-w-0">
                  <dt className="text-xs font-medium text-muted-foreground">{copy.deadlineDetail}</dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2 font-medium text-foreground">
                    <span className={`inline-flex items-center gap-1.5 ${overdue ? "text-destructive" : ""}`}>
                      <Calendar className={`size-3.5 ${overdue ? "text-destructive" : "text-subtle-foreground"}`} />
                      {deadline}
                    </span>
                    {overdue ? <StatusBadge variant="danger">{t("orders.detail.overdue")}</StatusBadge> : null}
                  </dd>
                </div>
              ) : null}

              {shouldShowOrderAssetValue(workflow.orderFields.device, selectedOrder.device, "device") && (
                <DetailItem label={copy.deviceDetail} value={selectedOrder.device} />
              )}
              {shouldShowOrderAssetValue(workflow.orderFields.carNumber, selectedOrder.carNumber, "carNumber") && (
                <DetailItem label={copy.carNumberDetail} value={selectedOrder.carNumber} />
              )}
              {shouldShowOrderAssetValue(workflow.orderFields.vin, selectedOrder.vin, "vin") && (
                <DetailItem label={copy.vinDetail} value={selectedOrder.vin} mono />
              )}
            </dl>

            <div className="border-t border-border pt-5">
              <OrderAssigneeSelect
                id="order-assignee"
                label={copy.assignedEmployeeLabel}
                value={selectedOrder.assignedEmployeeId}
                options={technicianOptions}
                disabled={isAssigneeUpdating || isStatusUpdating}
                errorMessage={assigneeErrorMessage}
                emptyHint={assigneeEmptyHint}
                onChange={handleAssigneeChange}
              />
            </div>

            {hasServiceLines ? (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">{t("orders.detail.services")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("orders.detail.quantity")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("orders.detail.price")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("orders.detail.amount")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {serviceLines.map((line, index) => (
                      <tr key={line.id ?? `${line.serviceId}-${index}`}>
                        <td className="px-3 py-2 [overflow-wrap:anywhere] text-foreground">{line.serviceName}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{line.quantity}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatMoney(line.price)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatMoney(line.price * line.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : fallbackService ? (
              <DetailItem label={t("orders.detail.service")} value={fallbackService} />
            ) : null}

            {description ? (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground">{t("orders.detail.description")}</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere] text-foreground">{description}</p>
              </div>
            ) : null}

            <div className="border-t border-border pt-5">
              <Label htmlFor="order-status" className="mb-2 block">
                {t("orders.detail.updateStatus")}
              </Label>
              <Select
                value={selectedOrder.status}
                onValueChange={(value) => onStatusChange(value as OrderStatus)}
                disabled={isStatusUpdating || isAssigneeUpdating}
              >
                <SelectTrigger id="order-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {orderStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {industryOrderStatusLabel(workflow, status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(selectedOrder.createdAt || selectedOrder.updatedAt) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle-foreground tabular-nums">
                {selectedOrder.createdAt ? <p>{t("orders.detail.created", { date: selectedOrder.createdAt })}</p> : null}
                {selectedOrder.updatedAt ? <p>{t("orders.detail.updated", { date: selectedOrder.updatedAt })}</p> : null}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailItem({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  if (value == null || value === "") return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-1 font-mono text-[13px] [overflow-wrap:anywhere] text-foreground" : "mt-1 font-medium [overflow-wrap:anywhere] text-foreground"}>
        {value}
      </dd>
    </div>
  );
}
