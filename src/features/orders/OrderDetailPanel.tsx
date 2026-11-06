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
import WarrantyOrderSection from "./WarrantyOrderSection";
import { OrderWarrantyCoverageSection } from "./OrderWarrantyCoverageSection";
import { OrderLineWarrantyBadge } from "./OrderLineWarrantyBadge";
import { OrderWarrantyIndicator } from "./OrderWarrantyIndicator";
import { useOrdersWarrantyIndicators } from "./useOrdersWarrantyIndicators";
import ClientTypeBadge from "../clients/ClientTypeBadge";
import { industrySupportsClientVehicles } from "../industries/industryCapabilities";
import { industryOrderStatusLabel, shouldShowOrderAssetValue } from "../industries/industryWorkflow";
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
import { useIsWorkspaceOwnerId } from "../workspaces/useIsWorkspaceOwnerId";
import OrderWarehouseActions from "./OrderWarehouseActions";
import OrderAttachmentsSection from "./OrderAttachmentsSection";
import OrderFeedSection from "./OrderFeedSection";
import { PaymentHistorySection } from "../finance/PaymentHistorySection";
import { orderPaymentBalance } from "../finance/paymentCalculations";
import { useGetPayments } from "../finance/usePayments";
import { useGetStatusDefinitions } from "../statuses/useGetStatusDefinitions";
import { useMoveOrderOnBoard } from "./useMoveOrderOnBoard";
import { CancelOrderDialog } from "./CancelOrderDialog";
import { CloseOrderDialog } from "./CloseOrderDialog";
import { isOrderCurrentlyClosed, isOrderFormallyClosed } from "./orderLifecycle";
import {
  resolveCurrentUnifiedStatus,
  resolveUnifiedStatusSelection,
  unifiedStatusOptions,
} from "./unifiedOrderStatus";
import { activePaymentsBlockingOrderDelete, orderHasCancelSemantic } from "./orderDeletionEligibility";
import {
  canMutateOrderContent,
  canOfferCancelOrderAction,
  canOfferDeleteClosedOrderAction,
} from "./closedOrderPermissions";
import { useClosedOrderActionPermissions } from "./useClosedOrderPermissions";

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
  const { formatMoney } = useWorkspaceMoney();
  const { workflow, copy } = useIndustryWorkflow();
  const showClientVehicles = industrySupportsClientVehicles(workflow);
  const workspaceRole = useActiveWorkspaceRole();
  const { canWrite: subscriptionAllowsWrite } = useWorkspaceSubscription();
  const closedOrderPerms = useClosedOrderActionPermissions();
  const canWarehouse = withSubscriptionWriteAccess(canManageWarehouse(workspaceRole), subscriptionAllowsWrite);
  const canEditOrder = subscriptionAllowsWrite;
  const { employees, error: employeesError, isLoading: employeesLoading } = useGetEmployees();
  const { mutateAsync: updateOrder, isPending: isAssigneeUpdating } = useUpdateOrder();
  const { mutate: moveOnBoard, isPending: isUnifiedStatusUpdating } = useMoveOrderOnBoard();
  const { data: orderStatusDefinitions = [] } = useGetStatusDefinitions("order");
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const statusOptions = unifiedStatusOptions(orderStatusDefinitions, (status) =>
    industryOrderStatusLabel(workflow, status),
  );
  const currentUnifiedStatus = selectedOrder
    ? resolveCurrentUnifiedStatus(selectedOrder, statusOptions)
    : null;
  const taxInvoiceRequired = workspace?.requireTaxInvoiceNumber === true;
  // Paid unlock uses membership owner role. Lifecycle status is never editable via the ordinary selector.
  const isWorkspaceOwner = canManageWorkspace(workspaceRole);
  const isOwnerByOwnerId = useIsWorkspaceOwnerId();
  const canManageClosedContent = closedOrderPerms.canManageClosedContent;
  const canMutateContent =
    selectedOrder != null &&
    canMutateOrderContent({
      order: selectedOrder,
      isOwnerByOwnerId,
      ownerCanManageClosedOrders: closedOrderPerms.ownerCanManageClosedOrders,
    });
  const paidStatusLocked = selectedOrder != null && isOrderPaidLocked(selectedOrder, isWorkspaceOwner);
  // Cancelled: owner_id may reopen via status change (clears closed_at). Ordinary closed
  // still requires owner_can_manage_closed_orders. Non-owners stay locked on both.
  const lifecycleStatusLocked =
    selectedOrder != null &&
    (selectedOrder.status === "cancelled"
      ? !isOwnerByOwnerId
      : isOrderFormallyClosed(selectedOrder) && !canManageClosedContent);
  const closedContentLocked = selectedOrder != null && !canMutateContent;
  const paidStatusBlocked =
    selectedOrder != null && isPaidStatusOptionBlocked(selectedOrder, taxInvoiceRequired) && selectedOrder.status !== "paid";
  const technicianOptions = assignableTechnicians(employees, selectedOrder?.assignedEmployeeId);
  const { payments, isLoading: paymentsLoading } = useGetPayments();
  const paymentBalance = selectedOrder ? orderPaymentBalance(selectedOrder, payments) : null;
  const deleteOrder = useDeleteOrder();
  const hasInvoice = Boolean(invoiceNumber);
  const isCancelledForDelete = selectedOrder
    ? orderHasCancelSemantic(selectedOrder, orderStatusDefinitions)
    : false;
  const activePaymentsBlockingDelete = selectedOrder
    ? activePaymentsBlockingOrderDelete(payments, selectedOrder.id)
    : [];
  const deleteBlockedReason = !selectedOrder
    ? null
    : hasInvoice
      ? t("orders.errors.cannotDeleteWithInvoice")
      : !isCancelledForDelete
        ? t("orders.delete.requireCancelled")
        : activePaymentsBlockingDelete.length > 0
          ? t("orders.errors.cannotDeleteWithActivePayments")
          : !canOfferDeleteClosedOrderAction({
                order: selectedOrder,
                workspaceRole,
                grants: closedOrderPerms.grants,
                isOwnerByOwnerId,
                ownerCanManageClosedOrders: closedOrderPerms.ownerCanManageClosedOrders,
              })
            ? t("orders.errors.deleteClosedForbidden")
            : null;
  const showOpenLifecycleActions =
    canEditOrder && selectedOrder != null && !isOrderFormallyClosed(selectedOrder) && selectedOrder.status !== "cancelled";
  const showCancelClosedAction =
    selectedOrder != null &&
    canOfferCancelOrderAction({
      order: selectedOrder,
      canWrite: canEditOrder,
      workspaceRole,
      grants: closedOrderPerms.grants,
      isOwnerByOwnerId,
      ownerCanManageClosedOrders: closedOrderPerms.ownerCanManageClosedOrders,
    }) &&
    isOrderFormallyClosed(selectedOrder);
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
    if (closedContentLocked) return;
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
          <SheetTitle className="min-w-0">
            <span className="flex min-w-0 flex-wrap items-center gap-2 tabular-nums">
              {selectedOrder?.orderNumber}
              {selectedOrder && !isEditing && <OrderStatusBadge status={selectedOrder.status} customStatus={selectedOrder.customStatus} />}
              {selectedOrder?.warrantySourceOrderId && !isEditing ? (
                <StatusBadge variant="warning">{t("orders.warranty.badge")}</StatusBadge>
              ) : null}
            </span>
            {selectedOrder && !isEditing ? (
              <OrderDetailWarrantyUnderNumber order={selectedOrder} />
            ) : null}
          </SheetTitle>
          {selectedOrder && !isEditing && canEditOrder && !closedContentLocked && (
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
            {selectedOrder.warrantySourceOrderId ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2" data-warranty-claim-banner>
                <p className="text-sm font-semibold text-foreground">{t("orders.warranty.claimTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("orders.warranty.claimHint")}</p>
              </div>
            ) : null}

            <WarrantyOrderSection
              order={selectedOrder}
              currentMileage={selectedOrder.vehicleMileageSnapshot ?? null}
              disabled={!canEditOrder || closedContentLocked}
              onChanged={() => {
                void onOrderUpdated(selectedOrder);
              }}
            />

            <OrderWarrantyCoverageSection
              order={selectedOrder}
              currentMileage={selectedOrder.vehicleMileageSnapshot ?? null}
            />

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
                disabled={!canEditOrder || closedContentLocked || isAssigneeUpdating || isStatusUpdating}
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
                          <div className="min-w-0 space-y-0.5">
                            <p>
                              {line.serviceName}
                              {line.kind ? (
                                <StatusBadge variant="muted" className="ml-2 align-middle">
                                  {t(`orders.form.lineKind.${line.kind}`)}
                                </StatusBadge>
                              ) : null}
                            </p>
                            <OrderLineWarrantyBadge
                              activated={Boolean(selectedOrder.closedAt)}
                              limits={{
                                durationMonths: line.warrantyMonths ?? null,
                                durationDays: line.warrantyDays ?? null,
                                mileageLimit: line.warrantyKm ?? null,
                              }}
                            />
                          </div>
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
                                <OrderLineWarrantyBadge
                                  activated={Boolean(selectedOrder.closedAt)}
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
                <OrderWarehouseActions
                  order={selectedOrder}
                  canManage={canWarehouse && !closedContentLocked}
                  onOrderUpdated={onOrderUpdated}
                />
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
              canRecord={canEditOrder && !closedContentLocked}
            />

            <OrderAttachmentsSection
              orderId={selectedOrder.id}
              enabled={detailPanelOpen}
              canMutateOverride={closedContentLocked ? false : undefined}
            />

            <OrderFeedSection
              orderId={selectedOrder.id}
              enabled={detailPanelOpen}
              canComment={canEditOrder && !closedContentLocked}
            />

            <div className="border-t border-border pt-5">
              <Label htmlFor="order-status" className="mb-2 block">
                {lifecycleStatusLocked || paidStatusLocked
                  ? t("orders.actions.statusLocked")
                  : t("orders.detail.updateStatus")}
              </Label>
              {lifecycleStatusLocked ? (
                <div id="order-status" className="flex items-center gap-2">
                  <OrderStatusBadge status={selectedOrder.status} customStatus={selectedOrder.customStatus} />
                  <span className="text-xs text-muted-foreground">
                    {selectedOrder.status === "cancelled"
                      ? t("orders.lifecycle.errors.orderAlreadyCancelled")
                      : t("orders.lifecycle.errors.orderAlreadyClosed")}
                  </span>
                </div>
              ) : (
              <Select
                value={currentUnifiedStatus?.id ?? statusOptions[0]?.id ?? ""}
                onValueChange={(value) => {
                  if (isOrderPaidLocked(selectedOrder, isWorkspaceOwner)) return;
                  const option = statusOptions.find((item) => item.id === value);
                  if (!option) return;
                  const move = resolveUnifiedStatusSelection(selectedOrder, option, {
                    allowManageClosed: canManageClosedContent,
                    allowReopenCancelled: isOwnerByOwnerId,
                  });
                  if (!move) return;
                  if (move.status === "paid" && isPaidStatusOptionBlocked(selectedOrder, taxInvoiceRequired)) return;

                  if (option.kind === "definition" || move.customStatusId !== null || selectedOrder.customStatusId) {
                    moveOnBoard(
                      {
                        orderId: selectedOrder.id,
                        status: move.status,
                        customStatusId: move.customStatusId,
                        currentStatus: selectedOrder.status,
                      },
                      {
                        onSuccess: (result) => {
                          onOrderUpdated({
                            ...selectedOrder,
                            status: result.status,
                            customStatusId: result.customStatusId,
                            customStatus:
                              result.customStatus ??
                              (option.kind === "definition" ? { name: option.name, color: option.color } : null),
                            closedAt:
                              "closedAt" in result ? (result.closedAt ?? null) : selectedOrder.closedAt,
                            ...(result.status === "paid"
                              ? { isPaid: true, paymentStatus: "paid" as const }
                              : selectedOrder.status === "paid" && result.status !== "closed" && result.status !== "cancelled"
                                ? { isPaid: false, paymentStatus: "unpaid" as const }
                                : {}),
                          });
                        },
                      },
                    );
                    return;
                  }

                  onStatusChange(move.status);
                }}
                disabled={
                  !canEditOrder ||
                  isStatusUpdating ||
                  isUnifiedStatusUpdating ||
                  isAssigneeUpdating ||
                  paidStatusLocked
                }
              >
                <SelectTrigger id="order-status" className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => {
                    const blocksPaid = option.systemStatus === "paid" && paidStatusBlocked;
                    return (
                      <SelectItem
                        key={option.id}
                        value={option.id}
                        disabled={paidStatusLocked || blocksPaid}
                        title={
                          paidStatusLocked
                            ? t("orders.errors.paidStatusLocked")
                            : blocksPaid
                              ? t("orders.taxInvoice.requiredHint")
                              : undefined
                        }
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          {option.color ? (
                            <span
                              aria-hidden
                              className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-border"
                              style={{ backgroundColor: option.color }}
                            />
                          ) : null}
                          <span className="min-w-0 [overflow-wrap:anywhere]">{option.name}</span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              )}
              {isOrderCurrentlyClosed(selectedOrder) ? (
                <div className="mt-3 space-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm" data-closed-order-banner>
                  <p className="font-medium text-foreground">{t("orders.lifecycle.closedBadge")}</p>
                  <p className="text-xs text-muted-foreground">{t("orders.lifecycle.closedAt", { date: selectedOrder.closedAt })}</p>
                  {paymentBalance && paymentBalance.remaining > 0.005 ? (
                    <p className="text-sm text-destructive">
                      {t("orders.lifecycle.postCloseOutstanding", { amount: formatMoney(paymentBalance.remaining) })}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {showOpenLifecycleActions ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setCloseOpen(true)} disabled={isStatusUpdating || isUnifiedStatusUpdating}>
                    <Lock className="size-3.5" />
                    {t("orders.lifecycle.closeAction")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setCancelOpen(true)} disabled={isStatusUpdating || isUnifiedStatusUpdating}>
                    <CircleX className="size-3.5" />
                    {t("orders.lifecycle.cancelAction")}
                  </Button>
                </div>
              ) : null}
              {showCancelClosedAction ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setCancelOpen(true)} disabled={isStatusUpdating || isUnifiedStatusUpdating}>
                    <CircleX className="size-3.5" />
                    {t("orders.lifecycle.cancelAction")}
                  </Button>
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
                  disabled={Boolean(deleteBlockedReason) || deleteOrder.isPending}
                  title={deleteBlockedReason ?? undefined}
                  onClick={() => {
                    if (deleteBlockedReason) return;
                    setConfirmDeleteOpen(true);
                  }}
                >
                  <Trash2 className="size-4 shrink-0" />
                  <span className="truncate">{t("orders.actions.delete")}</span>
                </Button>
                {deleteBlockedReason ? (
                  <p className="mt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{deleteBlockedReason}</p>
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
                  : t("orders.delete.descriptionCancelledWithStock", {
                      number: selectedOrder.orderNumber || t("orders.emptyOrderLabel"),
                    })}
              </DialogDescription>
              <p className="text-sm text-muted-foreground">{t("orders.cancelFinance.deleteRemovesAll")}</p>
            </DialogHeader>
            {deleteBlockedReason ? (
              <p className="text-sm text-destructive" role="alert">
                {deleteBlockedReason}
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
                disabled={deleteOrder.isPending || Boolean(deleteBlockedReason)}
                onClick={() => {
                  if (deleteBlockedReason || deleteOrder.isPending) return;
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
        canRecordPayment={canEditOrder && !closedContentLocked}
        onClosed={(result) => {
          if (!selectedOrder) return;
          onOrderUpdated({
            ...selectedOrder,
            status: "closed",
            closedAt: result.closed_at ?? selectedOrder.closedAt,
            customStatusId: result.customStatusId,
            customStatus: result.customStatus,
          });
        }}
      />

      <CancelOrderDialog
        order={selectedOrder}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        onCancelled={(result) => {
          if (!selectedOrder) return;
          onOrderUpdated({
            ...selectedOrder,
            status: "cancelled",
            customStatusId: result.customStatusId,
            customStatus: result.customStatus,
            closedAt: result.closed_at ?? selectedOrder.closedAt,
          });
        }}
      />
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

function OrderDetailWarrantyUnderNumber({ order }: { order: Order }) {
  const { byOrderId } = useOrdersWarrantyIndicators([order]);
  return <OrderWarrantyIndicator model={byOrderId.get(order.id)} className="mt-1 font-normal" />;
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
