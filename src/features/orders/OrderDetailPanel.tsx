import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Calendar, Mail, Pencil, Phone, Save } from "lucide-react";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
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
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageWarehouse, canManageWorkspace } from "../workspaces/workspaceRoles";
import { useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
import { withSubscriptionWriteAccess } from "../workspaces/workspaceSubscription";
import {
  materialIssued,
  materialReturned,
  netOutsideWarehouse,
  remainingToIssue,
  warehouseMaterialStatus,
  warehouseStatusBadgeVariant,
} from "../inventory/warehouseMaterialStatus";
import useGetEmployees from "../employees/useGetEmployees";
import { isOrderOverdue } from "./orderVisibility";
import { localDateKey } from "../../pages/dashboardStats";
import { assignableTechnicians } from "./assignableTechnicians";
import OrderAssigneeSelect from "./OrderAssigneeSelect";
import { useUpdateOrder } from "./useUpdateOrder";
import { useUpdateOrderTaxInvoiceNumber } from "./useGetOrders";
import {
  hasTaxInvoiceNumber,
  isLegalEntityCustomer,
  isOrderPaidLocked,
  isPaidStatusOptionBlocked,
} from "./taxInvoice";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import OrderWarehouseActions from "./OrderWarehouseActions";
import OrderAttachmentsSection from "./OrderAttachmentsSection";

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
  const workspaceRole = useActiveWorkspaceRole();
  const { canWrite: subscriptionAllowsWrite } = useWorkspaceSubscription();
  const canWarehouse = withSubscriptionWriteAccess(canManageWarehouse(workspaceRole), subscriptionAllowsWrite);
  const canEditOrder = subscriptionAllowsWrite;
  const { employees, error: employeesError, isLoading: employeesLoading } = useGetEmployees();
  const { mutateAsync: updateOrder, isPending: isAssigneeUpdating } = useUpdateOrder();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const taxInvoiceRequired = workspace?.requireTaxInvoiceNumber === true;
  // Owner role unlocks Paid status controls; admin/manager do not. API re-checks owner_id.
  const isWorkspaceOwner = canManageWorkspace(workspaceRole);
  const paidStatusLocked = selectedOrder != null && isOrderPaidLocked(selectedOrder, isWorkspaceOwner);
  const paidStatusBlocked =
    selectedOrder != null && isPaidStatusOptionBlocked(selectedOrder, taxInvoiceRequired) && selectedOrder.status !== "paid";
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
  const materialLines = selectedOrder?.materials ?? [];
  const hasServiceLines = serviceLines.length > 0;
  const hasMaterialLines = materialLines.length > 0;
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
          {selectedOrder && !isEditing && canEditOrder && (
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

            {isLegalEntityCustomer(selectedOrder.clientType) ? (
              <TaxInvoiceNumberField
                // Include persisted number in the key so a reopen/refetch that
                // brings a saved value remounts with the correct input state.
                key={`${selectedOrder.id}:${selectedOrder.taxInvoiceNumber ?? ""}`}
                order={selectedOrder}
                required={taxInvoiceRequired}
                onSaved={onOrderUpdated}
              />
            ) : null}

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
                disabled={!canEditOrder || isAssigneeUpdating || isStatusUpdating}
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

            {hasMaterialLines ? (
              <div className="space-y-3">
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">{t("orders.detail.materials")}</th>
                        <th className="px-3 py-2 text-right font-medium">{t("orders.detail.quantity")}</th>
                        <th className="px-3 py-2 text-right font-medium">{t("orders.detail.price")}</th>
                        <th className="px-3 py-2 text-right font-medium">{t("orders.detail.amount")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {materialLines.map((line, index) => {
                        const status = warehouseMaterialStatus(line);
                        return (
                          <tr key={line.id ?? `${line.inventoryItemId}-${index}`}>
                            <td className="px-3 py-2 [overflow-wrap:anywhere] text-foreground">
                              <div className="space-y-1">
                                <p>{line.itemName}</p>
                                <StatusBadge variant={warehouseStatusBadgeVariant(status)}>
                                  {t(`orders.warehouse.status.${status}`)}
                                </StatusBadge>
                                <p className="text-[11px] text-muted-foreground tabular-nums">
                                  {t("orders.warehouse.fulfillmentSummary", {
                                    issued: materialIssued(line),
                                    returned: materialReturned(line),
                                    remaining: remainingToIssue(line),
                                    net: netOutsideWarehouse(line),
                                  })}
                                </p>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{line.quantity}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatMoney(line.price)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatMoney(line.price * line.quantity)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <OrderWarehouseActions order={selectedOrder} canManage={canWarehouse} onOrderUpdated={onOrderUpdated} />
              </div>
            ) : null}

            {description ? (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground">{t("orders.detail.description")}</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere] text-foreground">{description}</p>
              </div>
            ) : null}

            <OrderAttachmentsSection orderId={selectedOrder.id} enabled={detailPanelOpen} />

            <div className="border-t border-border pt-5">
              <Label htmlFor="order-status" className="mb-2 block">
                {paidStatusLocked ? t("orders.actions.statusLocked") : t("orders.detail.updateStatus")}
              </Label>
              <Select
                value={selectedOrder.status}
                onValueChange={(value) => {
                  const next = value as OrderStatus;
                  // Must pass the same owner flag used for `paidStatusLocked` / disabled —
                  // omitting it defaults to non-owner and silently drops owner Paid→* changes.
                  if (isOrderPaidLocked(selectedOrder, isWorkspaceOwner)) return;
                  if (next === "paid" && isPaidStatusOptionBlocked(selectedOrder, taxInvoiceRequired)) return;
                  onStatusChange(next);
                }}
                disabled={!canEditOrder || isStatusUpdating || isAssigneeUpdating || paidStatusLocked}
              >
                <SelectTrigger id="order-status" className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {orderStatuses.map((status) => (
                    <SelectItem
                      key={status}
                      value={status}
                      disabled={paidStatusLocked || (status === "paid" && paidStatusBlocked)}
                      title={
                        paidStatusLocked
                          ? t("orders.errors.paidStatusLocked")
                          : status === "paid" && paidStatusBlocked
                            ? t("orders.taxInvoice.requiredHint")
                            : undefined
                      }
                    >
                      {industryOrderStatusLabel(workflow, status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {paidStatusLocked ? (
                <p className="mt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{t("orders.actions.paidStatusImmutable")}</p>
              ) : paidStatusBlocked ? (
                <p className="mt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{t("orders.taxInvoice.paidRequiresNumber")}</p>
              ) : null}
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

function TaxInvoiceNumberField({
  order,
  required,
  onSaved,
}: {
  order: Order;
  required: boolean;
  onSaved: (order: Order) => void;
}) {
  const { t } = useTranslation();
  const { mutateAsync: saveTaxInvoiceNumber, isPending } = useUpdateOrderTaxInvoiceNumber();
  const savedValue = order.taxInvoiceNumber ?? "";
  const [value, setValue] = useState(savedValue);

  // Re-adopt the persisted value when the order is reopened or refetched after
  // pay/status/cache updates (same component instance can receive a newly
  // hydrated taxInvoiceNumber without remounting).
  useEffect(() => {
    setValue(savedValue);
  }, [order.id, savedValue]);

  const trimmed = value.trim();
  const dirty = trimmed !== savedValue.trim();
  // Validate against the latest persisted order value — never local draft text.
  const missingRequired = required && !hasTaxInvoiceNumber(order);

  async function handleSave() {
    if (!dirty || isPending) return;
    try {
      const saved = await saveTaxInvoiceNumber({ orderId: order.id, taxInvoiceNumber: value });
      onSaved({ ...order, taxInvoiceNumber: saved });
      toast.success(t("orders.taxInvoice.saved"), { id: "tax-invoice-saved" });
    } catch {
      return;
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="order-tax-invoice-number">{t("orders.taxInvoice.label")}</Label>
      <div className="flex gap-2">
        <Input
          id="order-tax-invoice-number"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t("orders.taxInvoice.placeholder")}
          disabled={isPending}
          className="min-w-0 flex-1"
          aria-invalid={missingRequired || undefined}
        />
        <Button type="button" variant="outline" onClick={handleSave} disabled={!dirty || isPending} className="shrink-0">
          <Save />
          {isPending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
      {missingRequired ? <p className="text-xs text-destructive">{t("orders.taxInvoice.requiredHint")}</p> : null}
    </div>
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
