import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Calendar, CircleX, Eye, EyeOff, Lock, Pencil, Phone, Save, Trash2 } from "lucide-react";
import { displayCustomFieldValue } from "../../services/apiCustomFields";
import { customEditFieldKey } from "./orderFieldRegistry";
import { fieldConfigMap, useOrderCustomFieldValues, useOrderFieldConfig } from "./useOrderFieldConfig";
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
import { OrderFieldEditButton } from "./OrderFieldEditButton";
import type { OrderEditField } from "./orderEditFields";
import WarrantyOrderSection from "./WarrantyOrderSection";
import { OrderWarrantyCoverageSection } from "./OrderWarrantyCoverageSection";
import { OrderLineWarrantyBadge } from "./OrderLineWarrantyBadge";
import { OrderWarrantyIndicator } from "./OrderWarrantyIndicator";
import { useOrdersWarrantyIndicators } from "./useOrdersWarrantyIndicators";
import ClientTypeBadge from "../clients/ClientTypeBadge";
import { industrySupportsClientVehicles, industryUsesMileageWarranty } from "../industries/industryCapabilities";
import { industryProfile } from "../industries/industryProfile";
import { shouldShowOrderAssetValue } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import { OrderLinkedVehicleDetails } from "./OrderLinkedVehicleDetails";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { effectiveOrderVatRate, orderVatBreakdown } from "../finance/orderVat";
import { useWorkspaceVatRate } from "../finance/useWorkspaceVatRate";
import { vatIncludedAmount } from "../finance/vat";
import { OrderVatBreakdownView } from "./OrderVatBreakdown";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageWarehouse } from "../workspaces/workspaceRoles";
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
import { formatQuantity } from "../../lib/quantity";
import { isCatalogOrderMaterial, resolveMaterialSupplySource } from "../inventory/orderMaterialLine";
import { orderLineAmount } from "../services/orderServiceLine";
import useGetEmployees from "../employees/useGetEmployees";
import { isOrderOverdue } from "./orderVisibility";
import { localDateKey } from "../../pages/dashboardStats";
import { assignableTeamOptions, assignableTechnicians } from "./assignableTechnicians";
import OrderAssigneeSelect from "./OrderAssigneeSelect";
import OrderTeamSelect from "./OrderTeamSelect";
import type { OrderTeamMemberInput } from "./orderTeam";
import { useUpdateOrder } from "./useUpdateOrder";
import { useDeleteOrder } from "./useDeleteOrder";
import { useUpdateOrderTaxInvoiceNumber } from "./useGetOrders";
import {
  hasTaxInvoiceNumber,
  isLegalEntityCustomer,
} from "./taxInvoice";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useIsWorkspaceOwnerId } from "../workspaces/useIsWorkspaceOwnerId";
import OrderWarehouseActions from "./OrderWarehouseActions";
import OrderAttachmentsSection from "./OrderAttachmentsSection";
import OrderFeedSection from "./OrderFeedSection";
import { PaymentHistorySection } from "../finance/PaymentHistorySection";
import { PaymentFormDialog } from "../finance/PaymentFormDialog";
import { OrderPaymentStagesSection } from "../finance/OrderPaymentStagesSection";
import { recordableOrderBalance } from "./minPaidStatusGuard";
import { orderPaymentBalance } from "../finance/paymentCalculations";
import { useGetPayments } from "../finance/usePayments";
import { useGetStatusDefinitions } from "../statuses/useGetStatusDefinitions";
import { OrderCancelChainDialog } from "./OrderCancelChainDialog";
import { CloseOrderDialog } from "./CloseOrderDialog";
import { isOrderCurrentlyClosed, isOrderFormallyClosed } from "./orderLifecycle";
import { useOrderStatusChange } from "./useOrderStatusChange";
import { activePaymentsBlockingOrderDelete, orderHasCancelSemantic } from "./orderDeletionEligibility";
import {
  canMutateOrderContent,
  canOfferCancelOrderAction,
  canOfferDeleteClosedOrderAction,
} from "./closedOrderPermissions";
import { useClosedOrderActionPermissions } from "./useClosedOrderPermissions";
import { useConfirm } from "../../ui/ConfirmProvider";
import { prepareOrderForCloseOrPayment } from "./requestCloseOrder";

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
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const [isEditing, setIsEditing] = useState(false);
  const [editFocusField, setEditFocusField] = useState<OrderEditField | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState(selectedOrder?.id);
  const { formatMoney } = useWorkspaceMoney();
  const { rate: workspaceVatRate } = useWorkspaceVatRate();
  const { workflow, copy, profile, industrySlug } = useIndustryWorkflow();
  const industryBlocks = profile?.orderFieldBlocks ?? industryProfile(industrySlug).orderFieldBlocks;
  const showClientVehicles = industrySupportsClientVehicles(workflow);
  const showWarrantyKm = industryUsesMileageWarranty(workflow);
  const workspaceRole = useActiveWorkspaceRole();
  const { canWrite: subscriptionAllowsWrite } = useWorkspaceSubscription();
  const closedOrderPerms = useClosedOrderActionPermissions();
  const canWarehouse = withSubscriptionWriteAccess(canManageWarehouse(workspaceRole), subscriptionAllowsWrite);
  const canEditOrder = subscriptionAllowsWrite;
  const { employees, error: employeesError, isLoading: employeesLoading } = useGetEmployees();
  const { mutateAsync: updateOrder, isPending: isAssigneeUpdating } = useUpdateOrder();
  const { data: orderStatusDefinitions = [] } = useGetStatusDefinitions("order");
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const taxInvoiceRequired = workspace?.requireTaxInvoiceNumber === true;
  const isOwnerByOwnerId = useIsWorkspaceOwnerId();
  const canMutateContent =
    selectedOrder != null &&
    canMutateOrderContent({
      order: selectedOrder,
      isOwnerByOwnerId,
      ownerCanManageClosedOrders: closedOrderPerms.ownerCanManageClosedOrders,
    });
  const closedContentLocked = selectedOrder != null && !canMutateContent;
  const technicianOptions = assignableTechnicians(employees, selectedOrder?.assignedEmployeeId);
  const teamOptions = assignableTeamOptions(employees, selectedOrder?.assignedEmployeeId, [
    ...(selectedOrder?.team ?? []).map((member) => ({ id: member.employeeId, name: member.name })),
    ...(selectedOrder?.services ?? []).map((line) => ({ id: line.technicianId, name: line.technicianName })),
  ]);
  const { payments, isLoading: paymentsLoading } = useGetPayments();
  const {
    options: statusOptions,
    current: currentUnifiedStatus,
    changeTo: changeOrderStatus,
    isPending: isUnifiedStatusUpdating,
    paidStatusLocked,
    lifecycleStatusLocked,
    paidStatusBlocked,
  } = useOrderStatusChange(selectedOrder, {
    payments,
    paymentsLoading,
    onOrderUpdated,
    onLegacyStatusChange: onStatusChange,
  });
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
    setEditFocusField(null);
  }

  function stopEditing() {
    setIsEditing(false);
    setEditFocusField(null);
  }

  function startFieldEdit(field: OrderEditField) {
    setEditFocusField(field);
    setIsEditing(true);
  }

  function handleOpenChange(open: boolean) {
    setDetailPanelOpen(open);
    if (!open) {
      stopEditing();
      setConfirmDeleteOpen(false);
    }
  }

  const showFieldEdit = Boolean(selectedOrder && !isEditing && canEditOrder && !closedContentLocked);
  const { fields: orderFieldConfig } = useOrderFieldConfig();
  const orderFieldMap = useMemo(() => fieldConfigMap(orderFieldConfig), [orderFieldConfig]);
  const { data: customFieldValues = [] } = useOrderCustomFieldValues(selectedOrder?.id);
  const fieldLabel = (key: string, fallback: string) => orderFieldMap.get(key)?.label ?? fallback;
  const fieldVisible = (key: string, industryDefault = true) => {
    if (!industryDefault) return false;
    const cfg = orderFieldMap.get(key);
    return cfg ? cfg.visible : true;
  };

  async function requestClose() {
    if (!selectedOrder || isStatusUpdating || isUnifiedStatusUpdating) return;
    const prepared = await prepareOrderForCloseOrPayment({ order: selectedOrder, confirm, t });
    if (!prepared) return;
    if (prepared !== selectedOrder) {
      onOrderUpdated(prepared);
      stopEditing();
    }
    setCloseOpen(true);
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
        // Keep helpers (omitting team would reset it to assignee + line performers); the previous assignee is replaced.
        team: (selectedOrder.team ?? [])
          .filter((member) => member.employeeId !== selectedOrder.assignedEmployeeId)
          .map((member) => ({ employeeId: member.employeeId, role: member.role })),
        deadline: selectedOrder.deadline,
      });
      onOrderUpdated(updated);
    } catch {
      return;
    }
  }

  async function handleTeamChange(team: OrderTeamMemberInput[]) {
    if (!selectedOrder || isAssigneeUpdating) return;
    if (closedContentLocked) return;

    try {
      // `services` is omitted so saved lines stay untouched; the API merges line performers into the team.
      const updated = await updateOrder({
        orderId: selectedOrder.id,
        vehicleId: selectedOrder.vehicleId ?? undefined,
        device: selectedOrder.device,
        carNumber: selectedOrder.carNumber,
        vin: selectedOrder.vin,
        description: selectedOrder.description,
        assignedEmployeeId: selectedOrder.assignedEmployeeId,
        team,
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
  const detailVatRate = selectedOrder
    ? effectiveOrderVatRate(selectedOrder, workspaceVatRate)
    : null;
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
              onClick={() => {
                setEditFocusField(null);
                setIsEditing(true);
              }}
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
          <div className="space-y-5 px-5 py-5">
            <EditOrderForm
              key={`${selectedOrder.id}:${editFocusField ?? "top"}`}
              order={selectedOrder}
              initialFocusField={editFocusField ?? undefined}
              onCancel={stopEditing}
              onUpdated={(order) => {
                onOrderUpdated(order);
                stopEditing();
                setDetailPanelOpen(false);
              }}
            />
            <OrderPaymentStagesSection
              order={selectedOrder}
              payments={payments}
              canEdit={canEditOrder && !closedContentLocked}
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
              <div className="min-w-0 flex-1 space-y-2">
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
              <div className="min-w-0 max-w-[55%] shrink-0 text-right [overflow-wrap:anywhere]">
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
                <OrderVatBreakdownView
                  className="mt-2 space-y-0.5 text-xs text-muted-foreground"
                  breakdown={orderVatBreakdown({
                    total: selectedOrder.totalPrice,
                    vatRate: effectiveOrderVatRate(selectedOrder, workspaceVatRate),
                  })}
                  formatMoney={formatMoney}
                  showNoRateHint
                  testId="order-detail-vat"
                />
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
                  <dt className="flex min-w-0 items-center justify-between gap-1 text-xs font-medium text-muted-foreground">
                    <span className="min-w-0">{fieldLabel("deadline", copy.deadlineDetail)}</span>
                    {showFieldEdit ? (
                      <OrderFieldEditButton
                        field="deadline"
                        label={fieldLabel("deadline", copy.deadlineDetail)}
                        onEdit={startFieldEdit}
                      />
                    ) : null}
                  </dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2 font-medium text-foreground">
                    <span className={`inline-flex items-center gap-1.5 ${overdue ? "text-destructive" : ""}`}>
                      <Calendar className={`size-3.5 ${overdue ? "text-destructive" : "text-subtle-foreground"}`} />
                      {deadline}
                    </span>
                    {overdue ? <StatusBadge variant="danger">{t("orders.detail.overdue")}</StatusBadge> : null}
                  </dd>
                </div>
              ) : null}

              {!showClientVehicles &&
              fieldVisible("device", shouldShowOrderAssetValue(workflow.orderFields.device, selectedOrder.device, "device")) ? (
                <DetailItem
                  label={fieldLabel("device", copy.deviceDetail)}
                  value={selectedOrder.device}
                  editField={showFieldEdit ? "device" : undefined}
                  onEdit={showFieldEdit ? startFieldEdit : undefined}
                />
              ) : null}
              {!showClientVehicles &&
              fieldVisible("carNumber", shouldShowOrderAssetValue(workflow.orderFields.carNumber, selectedOrder.carNumber, "carNumber")) ? (
                <DetailItem
                  label={fieldLabel("carNumber", copy.carNumberDetail)}
                  value={selectedOrder.carNumber}
                  editField={showFieldEdit ? "carNumber" : undefined}
                  onEdit={showFieldEdit ? startFieldEdit : undefined}
                />
              ) : null}
              {!showClientVehicles &&
              fieldVisible("vin", shouldShowOrderAssetValue(workflow.orderFields.vin, selectedOrder.vin, "vin")) ? (
                <DetailItem
                  label={fieldLabel("vin", copy.vinDetail)}
                  value={selectedOrder.vin}
                  mono
                  editField={showFieldEdit ? "vin" : undefined}
                  onEdit={showFieldEdit ? startFieldEdit : undefined}
                />
              ) : null}
              {fieldVisible("deviceSerial", industryBlocks.deviceSerial) && selectedOrder.deviceSerial?.trim() ? (
                <DetailItem
                  label={fieldLabel("deviceSerial", t("orders.industryFields.deviceSerial"))}
                  value={selectedOrder.deviceSerial}
                  mono
                  editField={showFieldEdit ? "deviceSerial" : undefined}
                  onEdit={showFieldEdit ? startFieldEdit : undefined}
                />
              ) : null}
              {fieldVisible("deviceImei", industryBlocks.deviceImei) && selectedOrder.deviceImei?.trim() ? (
                <DetailItem
                  label={fieldLabel("deviceImei", t("orders.industryFields.deviceImei"))}
                  value={selectedOrder.deviceImei}
                  mono
                  editField={showFieldEdit ? "deviceImei" : undefined}
                  onEdit={showFieldEdit ? startFieldEdit : undefined}
                />
              ) : null}
              {fieldVisible("deviceCondition", industryBlocks.deviceCondition) && selectedOrder.deviceCondition?.trim() ? (
                <DetailItem
                  label={fieldLabel("deviceCondition", t("orders.industryFields.deviceCondition"))}
                  value={selectedOrder.deviceCondition}
                  editField={showFieldEdit ? "deviceCondition" : undefined}
                  onEdit={showFieldEdit ? startFieldEdit : undefined}
                />
              ) : null}
              {fieldVisible("deviceCompleteness", industryBlocks.deviceCompleteness) && selectedOrder.deviceCompleteness?.trim() ? (
                <DetailItem
                  label={fieldLabel("deviceCompleteness", t("orders.industryFields.deviceCompleteness"))}
                  value={selectedOrder.deviceCompleteness}
                  editField={showFieldEdit ? "deviceCompleteness" : undefined}
                  onEdit={showFieldEdit ? startFieldEdit : undefined}
                />
              ) : null}
              {fieldVisible("devicePasscode", industryBlocks.devicePasscode) && selectedOrder.devicePasscode?.trim() ? (
                <PasscodeDetailItem
                  label={fieldLabel("devicePasscode", t("orders.industryFields.devicePasscode"))}
                  value={selectedOrder.devicePasscode}
                  editField={showFieldEdit ? "devicePasscode" : undefined}
                  onEdit={showFieldEdit ? startFieldEdit : undefined}
                />
              ) : null}
              {fieldVisible("siteAddress", industryBlocks.siteAddress) && selectedOrder.siteAddress?.trim() ? (
                <DetailItem
                  label={fieldLabel("siteAddress", t("orders.industryFields.siteAddress"))}
                  value={selectedOrder.siteAddress}
                  editField={showFieldEdit ? "siteAddress" : undefined}
                  onEdit={showFieldEdit ? startFieldEdit : undefined}
                />
              ) : null}
              {fieldVisible("productDimensions", industryBlocks.productDimensions) && selectedOrder.productDimensions?.trim() ? (
                <DetailItem
                  label={fieldLabel("productDimensions", t("orders.industryFields.productDimensions"))}
                  value={selectedOrder.productDimensions}
                  editField={showFieldEdit ? "productDimensions" : undefined}
                  onEdit={showFieldEdit ? startFieldEdit : undefined}
                />
              ) : null}
              {fieldVisible("measurementAt", industryBlocks.measurementAt) && selectedOrder.measurementAt ? (
                <DetailItem
                  label={fieldLabel("measurementAt", t("orders.industryFields.measurementAt"))}
                  value={formatIndustryDateTime(selectedOrder.measurementAt, i18n.language)}
                  editField={showFieldEdit ? "measurementAt" : undefined}
                  onEdit={showFieldEdit ? startFieldEdit : undefined}
                />
              ) : null}
              {fieldVisible("installationAt", industryBlocks.installationAt) && selectedOrder.installationAt ? (
                <DetailItem
                  label={fieldLabel("installationAt", t("orders.industryFields.installationAt"))}
                  value={formatIndustryDateTime(selectedOrder.installationAt, i18n.language)}
                  editField={showFieldEdit ? "installationAt" : undefined}
                  onEdit={showFieldEdit ? startFieldEdit : undefined}
                />
              ) : null}
              {orderFieldConfig
                .filter((field) => field.isCustom && field.visible)
                .map((field) => {
                  const row = customFieldValues.find((value) => value.definitionId === field.definitionId);
                  const text = displayCustomFieldValue(field.type, row?.value, field.options);
                  if (!text && field.type !== "checkbox") return null;
                  return (
                    <DetailItem
                      key={field.key}
                      label={field.label}
                      value={field.type === "checkbox" ? (row?.value === true || row?.value === "true" ? "✓" : "—") : text}
                      editField={showFieldEdit ? customEditFieldKey(field.key) : undefined}
                      onEdit={showFieldEdit ? startFieldEdit : undefined}
                    />
                  );
                })}
            </dl>

            {showClientVehicles ? (
              <OrderLinkedVehicleDetails
                vehicleId={selectedOrder.vehicleId}
                vehicleMileageSnapshot={selectedOrder.vehicleMileageSnapshot ?? null}
                vehicleMileageUnitSnapshot={selectedOrder.vehicleMileageUnitSnapshot ?? null}
                onOpenRelatedOrder={(order) => {
                  onOrderUpdated(order);
                }}
                fieldConfig={orderFieldMap}
                showFieldEdit={showFieldEdit}
                onEditField={showFieldEdit ? startFieldEdit : undefined}
                sectionEditAction={
                  showFieldEdit ? (
                    <OrderFieldEditButton
                      field="vehicle"
                      label={fieldLabel("vehicle", t("vehicles.orderDetailsTitle"))}
                      onEdit={startFieldEdit}
                    />
                  ) : undefined
                }
              />
            ) : null}

            {fieldVisible("assignedEmployee") ? (
              <div className="border-t border-border pt-5">
                <OrderAssigneeSelect
                  id="order-assignee"
                  label={fieldLabel("assignedEmployee", copy.assignedEmployeeLabel)}
                  value={selectedOrder.assignedEmployeeId}
                  options={technicianOptions}
                  disabled={!canEditOrder || closedContentLocked || isAssigneeUpdating || isStatusUpdating}
                  errorMessage={assigneeErrorMessage}
                  emptyHint={assigneeEmptyHint}
                  onChange={handleAssigneeChange}
                />
              </div>
            ) : null}

            {fieldVisible("team") ? (
              <OrderTeamSelect
                id="order-team"
                label={fieldLabel("team", t("orders.team.title"))}
                value={(selectedOrder.team ?? []).map((member) => ({ employeeId: member.employeeId, role: member.role }))}
                options={teamOptions}
                disabled={!canEditOrder || closedContentLocked || isAssigneeUpdating || isStatusUpdating}
                onChange={handleTeamChange}
              />
            ) : null}

            {hasServiceLines ? (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">
                        <span className="flex min-w-0 items-center justify-between gap-1">
                          <span className="min-w-0">{t("orders.detail.services")}</span>
                          {showFieldEdit ? (
                            <OrderFieldEditButton
                              field="services"
                              label={t("orders.detail.services")}
                              onEdit={startFieldEdit}
                            />
                          ) : null}
                        </span>
                      </th>
                      <th className="px-3 py-2 text-right font-medium">{t("orders.detail.quantity")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("orders.detail.price")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("orders.detail.amount")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {serviceLines.map((line, index) => {
                      const lineGross = orderLineAmount({ price: line.price, quantity: line.quantity });
                      const lineVat =
                        detailVatRate != null ? vatIncludedAmount(lineGross, detailVatRate) : null;
                      return (
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
                            {line.technicianName?.trim() ? (
                              <p className="text-xs text-muted-foreground">
                                {t("orders.team.performer")}: {line.technicianName}
                              </p>
                            ) : null}
                            <OrderLineWarrantyBadge
                              activated={Boolean(selectedOrder.closedAt)}
                              status={
                                selectedOrder.closedAt &&
                                selectedOrder.status !== "closed"
                                  ? "paused"
                                  : undefined
                              }
                              startsAt={selectedOrder.closedAt}
                              mileageUnit={selectedOrder.vehicleMileageUnitSnapshot ?? "km"}
                              showWarrantyKm={showWarrantyKm}
                              limits={{
                                durationMonths: line.warrantyMonths ?? null,
                                durationDays: line.warrantyDays ?? null,
                                mileageLimit: line.warrantyKm ?? null,
                              }}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {formatQuantity(line.quantity, i18n.language)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatMoney(line.price)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground">
                          <div>{formatMoney(lineGross)}</div>
                          {lineVat != null ? (
                            <div className="text-[11px] text-muted-foreground">
                              {t("orders.vat.included")}: {formatMoney(lineVat)}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : fallbackService ? (
              <DetailItem
                label={t("orders.detail.service")}
                value={fallbackService}
                editField={showFieldEdit ? "services" : undefined}
                onEdit={showFieldEdit ? startFieldEdit : undefined}
              />
            ) : null}

            {hasMaterialLines ? (
              <div className="space-y-3">
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">
                          <span className="flex min-w-0 items-center justify-between gap-1">
                            <span className="min-w-0">{t("orders.detail.materials")}</span>
                            {showFieldEdit ? (
                              <OrderFieldEditButton
                                field="materials"
                                label={t("orders.detail.materials")}
                                onEdit={startFieldEdit}
                              />
                            ) : null}
                          </span>
                        </th>
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
                            ? copy.materialSourceCustomer
                            : source === "one_time"
                              ? t("orders.form.materialSourceOneTime")
                              : t("orders.form.materialSourceCatalog");
                        const status = catalog ? warehouseMaterialStatus(line) : null;
                        const lineGross = orderLineAmount({ price: line.price, quantity: line.quantity });
                        const lineVat =
                          detailVatRate != null ? vatIncludedAmount(lineGross, detailVatRate) : null;
                        return (
                          <tr key={line.id ?? `${line.inventoryItemId ?? "free"}-${index}`}>
                            <td className="px-3 py-2 [overflow-wrap:anywhere] text-foreground">
                              <div className="space-y-1">
                                <p>{line.itemName}</p>
                                <OrderLineWarrantyBadge
                                  activated={Boolean(selectedOrder.closedAt)}
                                  status={
                                    selectedOrder.closedAt &&
                                    selectedOrder.status !== "closed"
                                      ? "paused"
                                      : undefined
                                  }
                                  startsAt={selectedOrder.closedAt}
                                  mileageUnit={selectedOrder.vehicleMileageUnitSnapshot ?? "km"}
                                  showWarrantyKm={showWarrantyKm}
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
                                        issued: formatQuantity(materialIssued(line), i18n.language),
                                        returned: formatQuantity(materialReturned(line), i18n.language),
                                        remaining: formatQuantity(remainingToIssue(line), i18n.language),
                                        net: formatQuantity(netOutsideWarehouse(line), i18n.language),
                                      })}
                                    </p>
                                  </>
                                ) : (
                                  <p className="text-[11px] text-muted-foreground">{t("orders.form.freeformNoStockImpact")}</p>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {formatQuantity(line.quantity, i18n.language)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatMoney(line.price)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-foreground">
                              <div>{formatMoney(lineGross)}</div>
                              {lineVat != null ? (
                                <div className="text-[11px] text-muted-foreground">
                                  {t("orders.vat.included")}: {formatMoney(lineVat)}
                                </div>
                              ) : null}
                            </td>
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
                <div className="flex min-w-0 items-center justify-between gap-1">
                  <h3 className="min-w-0 text-xs font-medium text-muted-foreground">{t("orders.detail.description")}</h3>
                  {showFieldEdit ? (
                    <OrderFieldEditButton
                      field="description"
                      label={t("orders.detail.description")}
                      onEdit={startFieldEdit}
                    />
                  ) : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere] text-foreground">{description}</p>
              </div>
            ) : null}

            <PaymentHistorySection
              target="order"
              order={selectedOrder}
              payments={payments}
              isLoading={paymentsLoading}
              canRecord={canEditOrder && !closedContentLocked}
              onBeforeRecord={async () => {
                const prepared = await prepareOrderForCloseOrPayment({ order: selectedOrder, confirm, t });
                if (!prepared) return false;
                if (prepared !== selectedOrder) {
                  onOrderUpdated(prepared);
                  stopEditing();
                }
                return true;
              }}
            />

            <OrderPaymentStagesSection
              order={selectedOrder}
              payments={payments}
              canEdit={canEditOrder && !closedContentLocked}
              onOrderUpdated={onOrderUpdated}
              onBeforeRecord={async () => {
                const prepared = await prepareOrderForCloseOrPayment({ order: selectedOrder, confirm, t });
                if (!prepared) return false;
                if (prepared !== selectedOrder) {
                  onOrderUpdated(prepared);
                  stopEditing();
                }
                return true;
              }}
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
                      : t("orders.lifecycle.errors.closedOrderImmutable")}
                  </span>
                </div>
              ) : (
              <Select
                value={currentUnifiedStatus?.id ?? statusOptions[0]?.id ?? ""}
                onValueChange={(value) => {
                  if (!value || value === currentUnifiedStatus?.id) return;
                  void changeOrderStatus(value);
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
                  {statusOptions.map((option) => (
                    <SelectItem
                      key={option.id}
                      value={option.id}
                      disabled={option.disabled}
                      title={option.disabledReason ?? undefined}
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
                  ))}
                </SelectContent>
              </Select>
              )}
              {isOrderCurrentlyClosed(selectedOrder) ? (
                <div className="mt-3 space-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm" data-closed-order-banner>
                  <p className="font-medium text-foreground">{t("orders.lifecycle.closedBadge")}</p>
                  <p className="text-xs text-muted-foreground">{t("orders.lifecycle.closedAt", { date: selectedOrder.closedAt })}</p>
                  <p
                    className="text-xs text-muted-foreground"
                    data-closed-order-immutable-hint
                    data-testid="closed-order-immutable-hint"
                  >
                    {t("orders.lifecycle.errors.closedOrderImmutable")}
                  </p>
                  {paymentBalance && paymentBalance.remaining > 0.005 ? (
                    <p className="text-sm text-destructive">
                      {t("orders.lifecycle.postCloseOutstanding", { amount: formatMoney(paymentBalance.remaining) })}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {showOpenLifecycleActions ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void requestClose()} disabled={isStatusUpdating || isUnifiedStatusUpdating}>
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
        onOrderRefreshed={onOrderUpdated}
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

      <OrderCancelChainDialog
        order={selectedOrder}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        onOrderUpdated={onOrderUpdated}
        onDeleted={onDeleted}
      />

      {recordPaymentOpen && selectedOrder ? (
        <PaymentFormDialog
          open
          onOpenChange={setRecordPaymentOpen}
          target="order"
          order={selectedOrder}
          orderId={selectedOrder.id}
          balance={recordableOrderBalance(selectedOrder, payments)}
          onOrderUpdated={onOrderUpdated}
        />
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

function OrderDetailWarrantyUnderNumber({ order }: { order: Order }) {
  const { workflow } = useIndustryWorkflow();
  const showWarrantyKm = industryUsesMileageWarranty(workflow);
  const { byOrderId } = useOrdersWarrantyIndicators([order], { useMileageWarranty: showWarrantyKm });
  return <OrderWarrantyIndicator model={byOrderId.get(order.id)} className="mt-1 font-normal" />;
}

function formatIndustryDateTime(iso: string, locale: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat(locale || "en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function DetailItem({
  label,
  value,
  mono,
  editField,
  onEdit,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  editField?: OrderEditField;
  onEdit?: (field: OrderEditField) => void;
}) {
  if (value == null || value === "") return null;
  return (
    <div className="min-w-0">
      <dt className="flex min-w-0 items-center justify-between gap-1 text-xs font-medium text-muted-foreground">
        <span className="min-w-0">{label}</span>
        {editField && onEdit ? <OrderFieldEditButton field={editField} label={label} onEdit={onEdit} /> : null}
      </dt>
      <dd
        className={
          mono
            ? "mt-1 font-mono text-[13px] [overflow-wrap:anywhere] text-foreground"
            : "mt-1 font-medium [overflow-wrap:anywhere] text-foreground"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function PasscodeDetailItem({
  label,
  value,
  editField,
  onEdit,
}: {
  label: string;
  value: string;
  editField?: OrderEditField;
  onEdit?: (field: OrderEditField) => void;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <div className="min-w-0">
      <dt className="flex min-w-0 items-center justify-between gap-1 text-xs font-medium text-muted-foreground">
        <span className="min-w-0">{label}</span>
        {editField && onEdit ? <OrderFieldEditButton field={editField} label={label} onEdit={onEdit} /> : null}
      </dt>
      <dd className="mt-1 flex items-center gap-2 font-medium text-foreground">
        <span className="min-w-0 font-mono text-[13px] [overflow-wrap:anywhere]">{visible ? value : "••••••••"}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={visible ? t("orders.industryFields.hidePasscode") : t("orders.industryFields.showPasscode")}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </Button>
      </dd>
    </div>
  );
}
