import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Calendar, CircleX, Lock, Pencil, Phone, Save, Trash2 } from "lucide-react";
import { Button } from "../../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/Dialog";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { OrderStatusBadge, PaymentStatusBadge, StatusBadge } from "../../ui/StatusBadge";
import type { Order, OrderStatus } from "../../lib/types";
import EditOrderForm from "./EditOrderForm";
import ClientTypeBadge from "../clients/ClientTypeBadge";
import { industrySupportsClientVehicles } from "../industries/industryCapabilities";
import { industryOrderStatusLabel, ORDER_STATUSES, shouldShowOrderAssetValue } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { OrderLinkedVehicleDetails } from "./OrderLinkedVehicleDetails";
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
import { isCatalogOrderMaterial, resolveMaterialSupplySource } from "../inventory/orderMaterialLine";
import useGetEmployees from "../employees/useGetEmployees";
import { isOrderOverdue } from "./orderVisibility";
import { localDateKey } from "../../pages/dashboardStats";
import { assignableTechnicians } from "./assignableTechnicians";
import OrderAssigneeSelect from "./OrderAssigneeSelect";
import { useUpdateOrder } from "./useUpdateOrder";
import { useDeleteOrder } from "./useDeleteOrder";
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
import OrderFeedSection from "./OrderFeedSection";
import { PaymentHistorySection } from "../finance/PaymentHistorySection";
import { orderPaymentBalance } from "../finance/paymentCalculations";
import { useGetPayments } from "../finance/usePayments";
import { useGetStatusDefinitions } from "../statuses/useGetStatusDefinitions";
import { useMoveOrderOnBoard } from "./useMoveOrderOnBoard";
import { CloseOrderDialog } from "./CloseOrderDialog";
import { isOrderFormallyClosed } from "./orderLifecycle";
import { useCancelOrder } from "./useCloseOrder";

function systemStatusToOrderStatus(value: string | null | undefined): OrderStatus | null {
  if (!value) return null;
  const normalized = value.trim().replace(/_/g, "-");
  return (ORDER_STATUSES as readonly string[]).includes(normalized) ? (normalized as OrderStatus) : null;
}

type OrderDetailPanelProps = {
  selectedOrder: Order | null;
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
  onOrderUpdated: (order: Order) => void;
  onStatusChange: (status: OrderStatus) => void;
  isStatusUpdating?: boolean;
  /** Invoice number already created from this order, if any — blocks hard delete. */
  invoiceNumber?: string;
  /** Called after a successful delete so the parent can clear selection and return to the list. */
  onDeleted?: (orderId: string) => void;
};

const orderStatuses: OrderStatus[] = ORDER_STATUSES;

export default function OrderDetailPanel({
  selectedOrder,
  detailPanelOpen,
  setDetailPanelOpen,
  onOrderUpdated,
  onStatusChange,
  isStatusUpdating = false,
  invoiceNumber,
  onDeleted,
}: OrderDetailPanelProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState(selectedOrder?.id);
  const cancelOrder = useCancelOrder();
  const { formatMoney } = useWorkspaceMoney();
  const { workflow, copy } = useIndustryWorkflow();
  const showClientVehicles = industrySupportsClientVehicles(workflow);
  const workspaceRole = useActiveWorkspaceRole();
  const { canWrite: subscriptionAllowsWrite } = useWorkspaceSubscription();
  const canWarehouse = withSubscriptionWriteAccess(canManageWarehouse(workspaceRole), subscriptionAllowsWrite);
  const canEditOrder = subscriptionAllowsWrite;
  const { employees, error: employeesError, isLoading: employeesLoading } = useGetEmployees();
  const { mutateAsync: updateOrder, isPending: isAssigneeUpdating } = useUpdateOrder();
  const { mutate: moveOnBoard, isPending: isCustomStatusUpdating } = useMoveOrderOnBoard();
  const { data: orderStatusDefinitions = [] } = useGetStatusDefinitions("order");
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const activeCustomStatuses = orderStatusDefinitions.filter(
    (status) => status.isActive && status.semanticAction === "normal",
  );
  const workflowStatuses = orderStatuses.filter(
    (status): status is Exclude<OrderStatus, "closed" | "cancelled"> => status !== "closed" && status !== "cancelled",
  );
  const taxInvoiceRequired = workspace?.requireTaxInvoiceNumber === true;
  // Owner role unlocks Paid status controls; admin/manager do not. API re-checks owner_id.
  const isWorkspaceOwner = canManageWorkspace(workspaceRole);
  const paidStatusLocked = selectedOrder != null && isOrderPaidLocked(selectedOrder, isWorkspaceOwner);
  const paidStatusBlocked =
    selectedOrder != null && isPaidStatusOptionBlocked(selectedOrder, taxInvoiceRequired) && selectedOrder.status !== "paid";
  const technicianOptions = assignableTechnicians(employees, selectedOrder?.assignedEmployeeId);
  const { payments, isLoading: paymentsLoading } = useGetPayments();
  const paymentBalance = selectedOrder ? orderPaymentBalance(selectedOrder, payments) : null;
  const deleteOrder = useDeleteOrder();
  const hasInvoice = Boolean(invoiceNumber);
  const linkedPaymentCount = selectedOrder
    ? payments.filter((payment) => payment.orderId === selectedOrder.id).length
    : 0;

  if (selectedOrder?.id !== editingOrderId) {
    setEditingOrderId(selectedOrder?.id);
    setIsEditing(false);
  }

  function handleOpenChange(open: boolean) {
    setDetailPanelOpen(open);
    if (!open) {
      setIsEditing(false);
      setConfirmDeleteOpen(false);
    }
  }

  async function handleAssigneeChange(assignedEmployeeId: string) {
    if (!selectedOrder || isAssigneeUpdating) return;
    if ((selectedOrder.assignedEmployeeId || "") === assignedEmployeeId) return;

    try {
      const updated = await updateOrder({
        orderId: selectedOrder.id,
        // Preserve linked vehicle; omitting vehicleId also leaves it unchanged, but
        // passing the current id makes assignee-only updates explicit.
        vehicleId: selectedOrder.vehicleId ?? undefined,
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
            {selectedOrder && !isEditing && <OrderStatusBadge status={selectedOrder.status} customStatus={selectedOrder.customStatus} />}
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
                {clientPhone ? (
                  <div className="space-y-1.5 pt-1 text-sm">
                    <div className="flex items-center gap-2">
                      <Phone className="size-3.5 shrink-0 text-subtle-foreground" />
                      <a href={`tel:${clientPhone}`} className="tabular-nums text-foreground hover:underline">
                        {clientPhone}
                      </a>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <h3 className="text-xs font-medium text-muted-foreground">{t("orders.detail.totalPrice")}</h3>
                <p className="mt-1 text-xl font-semibold tracking-tight text-foreground tabular-nums">{formatMoney(selectedOrder.totalPrice)}</p>
                {(selectedOrder.discountTotal ?? 0) > 0 ? (
                  <dl className="mt-1 space-y-0.5 text-xs text-muted-foreground tabular-nums" data-testid="order-detail-discount">
                    <div className="flex justify-end gap-2">
                      <dt>{t("orders.detail.subtotal")}</dt>
                      <dd>{formatMoney(selectedOrder.subtotal ?? selectedOrder.totalPrice + (selectedOrder.discountTotal ?? 0))}</dd>
                    </div>
                    <div className="flex justify-end gap-2">
                      <dt>{t("orders.detail.discount")}</dt>
                      <dd>−{formatMoney(selectedOrder.discountTotal ?? 0)}</dd>
                    </div>
                  </dl>
                ) : null}
                <div className="mt-2">
                  <PaymentStatusBadge status={paymentBalance?.status ?? selectedOrder.paymentStatus} />
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

              {!showClientVehicles && shouldShowOrderAssetValue(workflow.orderFields.device, selectedOrder.device, "device") ? (
                <DetailItem label={copy.deviceDetail} value={selectedOrder.device} />
              ) : null}
              {!showClientVehicles && shouldShowOrderAssetValue(workflow.orderFields.carNumber, selectedOrder.carNumber, "carNumber") ? (
                <DetailItem label={copy.carNumberDetail} value={selectedOrder.carNumber} />
              ) : null}
              {!showClientVehicles && shouldShowOrderAssetValue(workflow.orderFields.vin, selectedOrder.vin, "vin") ? (
                <DetailItem label={copy.vinDetail} value={selectedOrder.vin} mono />
              ) : null}
            </dl>

            {showClientVehicles ? (
              <OrderLinkedVehicleDetails
                vehicleId={selectedOrder.vehicleId}
                vehicleMileageSnapshot={selectedOrder.vehicleMileageSnapshot ?? null}
                vehicleMileageUnitSnapshot={selectedOrder.vehicleMileageUnitSnapshot ?? null}
                onOpenRelatedOrder={(order) => {
                  onOrderUpdated(order);
                }}
              />
            ) : null}

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
                        <td className="px-3 py-2 [overflow-wrap:anywhere] text-foreground">
                          {line.serviceName}
                          {line.kind ? (
                            <StatusBadge variant="muted" className="ml-2 align-middle">
                              {t(`orders.form.lineKind.${line.kind}`)}
                            </StatusBadge>
                          ) : null}
                        </td>
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
                        const catalog = isCatalogOrderMaterial(line);
                        const source = resolveMaterialSupplySource(line);
                        const sourceLabel =
                          source === "customer"
                            ? t("orders.form.materialSourceCustomer")
                            : source === "one_time"
                              ? t("orders.form.materialSourceOneTime")
                              : t("orders.form.materialSourceCatalog");
                        const status = catalog ? warehouseMaterialStatus(line) : null;
                        return (
                          <tr key={line.id ?? `${line.inventoryItemId ?? "free"}-${index}`}>
                            <td className="px-3 py-2 [overflow-wrap:anywhere] text-foreground">
                              <div className="space-y-1">
                                <p>{line.itemName}</p>
                                <p className="text-[11px] text-muted-foreground">{sourceLabel}</p>
                                {status ? (
                                  <>
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
                                  </>
                                ) : (
                                  <p className="text-[11px] text-muted-foreground">{t("orders.form.freeformNoStockImpact")}</p>
                                )}
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

            <PaymentHistorySection
              target="order"
              order={selectedOrder}
              payments={payments}
              isLoading={paymentsLoading}
              canRecord={canEditOrder}
            />

            <OrderAttachmentsSection orderId={selectedOrder.id} enabled={detailPanelOpen} />

            <OrderFeedSection orderId={selectedOrder.id} enabled={detailPanelOpen} canComment={canEditOrder} />

            <div className="border-t border-border pt-5">
              <Label htmlFor="order-status" className="mb-2 block">
                {paidStatusLocked ? t("orders.actions.statusLocked") : t("orders.detail.updateStatus")}
              </Label>
              <Select
                value={
                  (workflowStatuses as readonly OrderStatus[]).includes(selectedOrder.status)
                    ? selectedOrder.status
                    : workflowStatuses[0]
                }
                onValueChange={(value) => {
                  const next = value as OrderStatus;
                  // Must pass the same owner flag used for `paidStatusLocked` / disabled —
                  // omitting it defaults to non-owner and silently drops owner Paid→* changes.
                  if (isOrderPaidLocked(selectedOrder, isWorkspaceOwner)) return;
                  if (next === "paid" && isPaidStatusOptionBlocked(selectedOrder, taxInvoiceRequired)) return;
                  onStatusChange(next);
                }}
                disabled={!canEditOrder || isStatusUpdating || isCustomStatusUpdating || isAssigneeUpdating || paidStatusLocked}
              >
                <SelectTrigger id="order-status" className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {workflowStatuses.map((status) => (
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
              {selectedOrder.closedAt ? (
                <div className="mt-3 space-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                  <p className="font-medium text-foreground">{t("orders.lifecycle.closedBadge")}</p>
                  <p className="text-xs text-muted-foreground">{t("orders.lifecycle.closedAt", { date: selectedOrder.closedAt })}</p>
                  {paymentBalance && paymentBalance.remaining > 0.005 ? (
                    <p className="text-sm text-destructive">
                      {t("orders.lifecycle.postCloseOutstanding", { amount: formatMoney(paymentBalance.remaining) })}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {canEditOrder && !isOrderFormallyClosed(selectedOrder) && selectedOrder.status !== "cancelled" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setCloseOpen(true)} disabled={isStatusUpdating}>
                    <Lock className="size-3.5" />
                    {t("orders.lifecycle.closeAction")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setCancelOpen(true)} disabled={isStatusUpdating || cancelOrder.isPending}>
                    <CircleX className="size-3.5" />
                    {t("orders.lifecycle.cancelAction")}
                  </Button>
                </div>
              ) : null}
              {activeCustomStatuses.length > 0 ? (
                <div className="mt-3 space-y-2">
                  <Label htmlFor="order-custom-status" className="block">
                    {t("orders.detail.customStatus")}
                  </Label>
                  <Select
                    value={selectedOrder.customStatusId ?? "__none__"}
                    onValueChange={(value) => {
                      if (isOrderPaidLocked(selectedOrder, isWorkspaceOwner)) return;
                      const nextCustomId = value === "__none__" ? null : value;
                      if ((selectedOrder.customStatusId ?? null) === nextCustomId) return;
                      const definition = nextCustomId
                        ? activeCustomStatuses.find((item) => item.id === nextCustomId)
                        : null;
                      const nextSystem =
                        systemStatusToOrderStatus(definition?.systemStatus) ?? selectedOrder.status;
                      if (nextSystem === "paid" && isPaidStatusOptionBlocked(selectedOrder, taxInvoiceRequired)) return;
                      moveOnBoard(
                        {
                          orderId: selectedOrder.id,
                          status: nextSystem,
                          customStatusId: nextCustomId,
                          currentStatus: selectedOrder.status,
                        },
                        {
                          onSuccess: () => {
                            onOrderUpdated({
                              ...selectedOrder,
                              status: nextSystem,
                              customStatusId: nextCustomId,
                              customStatus: definition
                                ? { name: definition.name, color: definition.color }
                                : null,
                              ...(nextSystem === "paid"
                                ? { isPaid: true, paymentStatus: "paid" as const }
                                : (selectedOrder.status as string) === "paid"
                                  ? { isPaid: false, paymentStatus: "unpaid" as const }
                                  : {}),
                            });
                          },
                        },
                      );
                    }}
                    disabled={!canEditOrder || isStatusUpdating || isCustomStatusUpdating || isAssigneeUpdating || paidStatusLocked}
                  >
                    <SelectTrigger id="order-custom-status" className="w-full min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t("orders.detail.customStatusNone")}</SelectItem>
                      {activeCustomStatuses.map((status) => (
                        <SelectItem key={status.id} value={status.id}>
                          {status.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{t("orders.detail.customStatusHint")}</p>
                </div>
              ) : null}
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

            {canEditOrder ? (
              <div className="border-t border-border pt-4">
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full min-w-0 sm:w-auto"
                  disabled={hasInvoice || deleteOrder.isPending}
                  title={hasInvoice ? t("orders.errors.cannotDeleteWithInvoice") : undefined}
                  onClick={() => {
                    if (hasInvoice) return;
                    setConfirmDeleteOpen(true);
                  }}
                >
                  <Trash2 className="size-4 shrink-0" />
                  <span className="truncate">{t("orders.actions.delete")}</span>
                </Button>
                {hasInvoice ? (
                  <p className="mt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {t("orders.errors.cannotDeleteWithInvoice")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </SheetContent>

      {selectedOrder ? (
        <Dialog
          open={confirmDeleteOpen}
          onOpenChange={(open) => {
            if (deleteOrder.isPending) return;
            setConfirmDeleteOpen(open);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("orders.delete.title")}</DialogTitle>
              <DialogDescription>
                {linkedPaymentCount > 0
                  ? t("orders.delete.descriptionWithPayments", {
                      number: selectedOrder.orderNumber || t("orders.emptyOrderLabel"),
                      count: linkedPaymentCount,
                    })
                  : selectedOrder.status === "cancelled"
                    ? t("orders.delete.descriptionCancelledWithStock", {
                        number: selectedOrder.orderNumber || t("orders.emptyOrderLabel"),
                      })
                    : t("orders.delete.description", {
                        number: selectedOrder.orderNumber || t("orders.emptyOrderLabel"),
                      })}
              </DialogDescription>
            </DialogHeader>
            {hasInvoice ? (
              <p className="text-sm text-destructive" role="alert">
                {t("orders.errors.cannotDeleteWithInvoice")}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmDeleteOpen(false)}
                disabled={deleteOrder.isPending}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteOrder.isPending || hasInvoice}
                onClick={() => {
                  if (hasInvoice || deleteOrder.isPending) return;
                  void deleteOrder.mutateAsync(selectedOrder.id).then(() => {
                    setConfirmDeleteOpen(false);
                    onDeleted?.(selectedOrder.id);
                  });
                }}
              >
                {deleteOrder.isPending
                  ? t("common.deleting")
                  : linkedPaymentCount > 0
                    ? t("orders.delete.confirmWithPayments", { count: linkedPaymentCount })
                    : t("orders.actions.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <CloseOrderDialog
        order={selectedOrder}
        open={closeOpen}
        onOpenChange={setCloseOpen}
        payments={payments}
        formatMoney={formatMoney}
      />

      {selectedOrder ? (
        <Dialog
          open={cancelOpen}
          onOpenChange={(open) => {
            if (cancelOrder.isPending) return;
            setCancelOpen(open);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("orders.lifecycle.cancelTitle")}</DialogTitle>
              <DialogDescription>
                {t("orders.lifecycle.cancelDescription", { number: selectedOrder.orderNumber })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCancelOpen(false)} disabled={cancelOrder.isPending}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={cancelOrder.isPending}
                onClick={() => {
                  cancelOrder.mutate(selectedOrder.id, { onSuccess: () => setCancelOpen(false) });
                }}
              >
                {cancelOrder.isPending ? t("common.saving") : t("orders.lifecycle.confirmCancel")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
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
