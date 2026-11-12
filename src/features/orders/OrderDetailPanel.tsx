import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Calendar, CircleX, EllipsisVertical, Lock, Pencil, Save, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { displayCustomFieldValue, serializeCustomFieldValue } from "../../services/apiCustomFields";
import type { UpdateOrderFieldsPatch } from "../../services/apiOrders";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
import { customEditFieldKey, parseCustomEditField } from "./orderFieldRegistry";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/DropdownMenu";
import { Input } from "../../ui/Input";
import { Label } from "../../ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/Select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/Sheet";
import { Tabs, TabsList, TabsTrigger } from "../../ui/Tabs";
import { OrderStatusBadge, StatusBadge } from "../../ui/StatusBadge";
import type { Order, OrderMaterial, OrderStatus } from "../../lib/types";
import { computeOrderMoney, type LineDiscountType, type MoneyLine } from "./orderTotals";
import EditOrderForm, { type EditOrderFormHandle } from "./EditOrderForm";
import AddOrderMaterialDialog, { type AddOrderMaterialPrefill } from "./AddOrderMaterialDialog";
import OrderAddLinesSearch from "./OrderAddLinesSearch";
import OrderServiceLineInlineCells, {
  OrderServiceLinePerformerInline,
  type ServiceLineInlineEditTarget,
  type ServiceLineInlineField,
} from "./OrderServiceLineInlineCells";
import OrderMaterialLineInlineCells, {
  type MaterialLineInlineEditTarget,
  type MaterialLineInlineField,
} from "./OrderMaterialLineInlineCells";
import { useUpdateOrderServiceLine } from "./useUpdateOrderServiceLine";
import { useUpdateOrderMaterialLine } from "./useUpdateOrderMaterialLine";
import { useDeleteOrderServiceLine } from "./useDeleteOrderServiceLine";
import { useDeleteOrderMaterialLine } from "./useDeleteOrderMaterialLine";
import { parseOrderServiceLinePrice } from "./updateOrderServiceLine";
import { materialDraftForUndo } from "./deleteOrderMaterialLine";
import { appendOrderMaterialLines, appendOrderServiceLines } from "./appendOrderLines";
import { OrderLineDeleteButton } from "./OrderLineDeleteButton";
import { showOrderLineDeletedToast } from "./orderLineDeleteToast";
import { useGetWarehouses } from "../warehouses/useGetWarehouses";
import { useGetWarehouseStock } from "../warehouses/useGetWarehouseStock";
import { resolveCatalogLineStockLimit } from "./catalogMaterialStockLimit";
import {
  OrderInlineField,
  type OrderInlineFieldHandle,
  type OrderInlineFieldKind,
  type OrderInlineFieldValue,
} from "./OrderInlineField";
import { useUpdateOrderCustomFieldValue, useUpdateOrderFields } from "./useUpdateOrderFields";
import { combineDateTimeLocal, isInstallationBeforeMeasurement, splitDateTimeLocal } from "./industryOrderFieldHelpers";
import { buildOrderMileageSnapshot, parseVisitMileage, persistOrderVehicleMileage } from "./orderVehicleMileage";
import { useGetVehicle } from "../vehicles/useGetVehicle";
import type { OrderEditField } from "./orderEditFields";
import WarrantyOrderSection from "./WarrantyOrderSection";
import { OrderWarrantyCoverageSection } from "./OrderWarrantyCoverageSection";
import { OrderLineWarrantyBadge } from "./OrderLineWarrantyBadge";
import { OrderWarrantyIndicator } from "./OrderWarrantyIndicator";
import { useOrdersWarrantyIndicators } from "./useOrdersWarrantyIndicators";
import { industrySupportsClientVehicles, industryUsesMileageWarranty } from "../industries/industryCapabilities";
import { industryProfile } from "../industries/industryProfile";
import { shouldShowOrderAssetValue } from "../industries/industryWorkflow";
import { useIndustryWorkflow } from "../industries/useIndustryWorkflow";
import ChangeOrderClientDialog from "./ChangeOrderClientDialog";
import { OrderClientCard } from "./OrderClientCard";
import { OrderLinkedVehicleDetails } from "./OrderLinkedVehicleDetails";
import { useWorkspaceMoney } from "../workspaces/useWorkspaceMoney";
import { effectiveOrderVatRate } from "../finance/orderVat";
import { useWorkspaceVatRate } from "../finance/useWorkspaceVatRate";
import { vatIncludedAmount } from "../finance/vat";
import { OrderDetailHeaderTotal } from "./OrderDetailHeaderTotal";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageServices, canManageWarehouse } from "../workspaces/workspaceRoles";
import { OrderCatalogLinkDialogs } from "./OrderCatalogLinkDialogs";
import { useGuardSubscriptionWrite, useWorkspaceSubscription } from "../workspaces/useWorkspaceSubscription";
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
import { useGetInventoryItems } from "../inventory/useGetInventoryItems";
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
import { useGetOrderComments, useGetOrderEvents } from "./useOrderFeed";
import { PaymentHistorySection } from "../finance/PaymentHistorySection";
import { PaymentFormDialog } from "../finance/PaymentFormDialog";
import { OrderPaymentStagesSection } from "../finance/OrderPaymentStagesSection";
import { assertMinPaidOrExplain, orderNetPaidForMinPaid, recordableOrderBalance } from "./minPaidStatusGuard";
import { showMinPaidBlockedToast } from "./showMinPaidBlockedToast";
import { useOrderAttachments } from "./useOrderAttachments";
import {
  isOrderDetailTab,
  orderDetailItemsCount,
  peekOrderDetailTab,
  readOrderDetailTabOnOpen,
  usesWorksAndMaterialsTabLabel,
  writeOrderDetailTab,
  type OrderDetailTab,
} from "./orderDetailTabs";
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
import { useConfirm, useUnsavedChangesConfirm } from "../../ui/ConfirmProvider";
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
  /** Open the client card from the Information tab client card link. */
  onOpenClient?: (clientId: string) => void;
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
  onOpenClient,
}: OrderDetailPanelProps) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const confirmDiscardChanges = useUnsavedChangesConfirm();
  const queryClient = useQueryClient();
  const guardWrite = useGuardSubscriptionWrite();
  const sheetContentRef = useRef<HTMLDivElement | null>(null);
  const [changeClientOpen, setChangeClientOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  /** Field currently open in its click-to-edit editor (only one at a time). */
  const [editingField, setEditingField] = useState<OrderEditField | null>(null);
  /** Mirrors the active inline editor's dirty state (reported by OrderInlineField). */
  const [inlineDirty, setInlineDirty] = useState(false);
  const [editFocusField, setEditFocusField] = useState<OrderEditField | null>(null);
  /** Handle of the open inline editor (only the active field receives it) — used by the footer «Save & close». */
  const inlineFieldRef = useRef<OrderInlineFieldHandle | null>(null);
  const setInlineFieldHandle = useCallback((handle: OrderInlineFieldHandle | null) => {
    inlineFieldRef.current = handle;
  }, []);
  /** Handle of the full edit form — used by the footer «Save & close» in edit mode. */
  const editFormRef = useRef<EditOrderFormHandle>(null);
  const [editFormSubmitting, setEditFormSubmitting] = useState(false);
  /** True while the footer «Save & close» is waiting for an inline / form save. */
  const [footerSaving, setFooterSaving] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
  const [addMaterialPrefill, setAddMaterialPrefill] = useState<AddOrderMaterialPrefill | null>(null);
  const [highlightedServiceId, setHighlightedServiceId] = useState<string | null>(null);
  const [serviceLineEdit, setServiceLineEdit] = useState<ServiceLineInlineEditTarget | null>(null);
  const [materialLineEdit, setMaterialLineEdit] = useState<MaterialLineInlineEditTarget | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addLinesSearchFocusRef = useRef<(() => void) | null>(null);
  const updateServiceLine = useUpdateOrderServiceLine();
  const updateMaterialLine = useUpdateOrderMaterialLine();
  const deleteServiceLine = useDeleteOrderServiceLine();
  const deleteMaterialLine = useDeleteOrderMaterialLine();
  const { data: warehouses = [] } = useGetWarehouses();
  const { data: warehouseStock = [] } = useGetWarehouseStock();
  const [editingOrderId, setEditingOrderId] = useState(selectedOrder?.id);
  const isDesktopFeedLayout = useMediaQuery("(min-width: 1024px)");
  // Session-backed tab: survives order switches and sheet reopen; first open in a session starts on info.
  const [storedDetailTab, setStoredDetailTab] = useState<OrderDetailTab>(() =>
    detailPanelOpen ? readOrderDetailTabOnOpen() : peekOrderDetailTab(),
  );
  const [prevDetailPanelOpen, setPrevDetailPanelOpen] = useState(detailPanelOpen);
  if (detailPanelOpen !== prevDetailPanelOpen) {
    setPrevDetailPanelOpen(detailPanelOpen);
    if (detailPanelOpen) setStoredDetailTab(readOrderDetailTabOnOpen());
  }
  // History is a separate right column on desktop, so it is not a valid left-column tab there.
  const detailTab: OrderDetailTab = isDesktopFeedLayout && storedDetailTab === "history" ? "info" : storedDetailTab;
  async function selectDetailTab(tab: OrderDetailTab) {
    // Leaving the info tab unmounts the inline editor; never drop a draft silently.
    if (tab !== detailTab && editingField && !(await settleInlineEdit())) return;
    setStoredDetailTab(tab);
    writeOrderDetailTab(tab);
  }
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
  const canOpenServiceForm = withSubscriptionWriteAccess(canManageServices(workspaceRole), subscriptionAllowsWrite);
  /** Catalog windows opened by tapping a service / material name in the order card. */
  const [catalogServiceId, setCatalogServiceId] = useState<string | null>(null);
  const [catalogInventoryId, setCatalogInventoryId] = useState<string | null>(null);
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
    setEditingField(null);
    setAddMaterialOpen(false);
    setAddMaterialPrefill(null);
    setServiceLineEdit(null);
  }

  function stopEditing() {
    setIsEditing(false);
    setEditFocusField(null);
    setEditFormSubmitting(false);
  }

  /** Closes the sheet itself (never the order lifecycle) and drops any editor state. */
  function closeSheet() {
    setDetailPanelOpen(false);
    closeInlineEditor();
    stopEditing();
    setConfirmDeleteOpen(false);
  }

  function closeInlineEditor() {
    setInlineDirty(false);
    setEditingField(null);
  }

  /**
   * Resolve the open inline editor before something else takes over (another field, full form, tab, close).
   * Returns false when the user chose to keep editing.
   */
  async function settleInlineEdit(): Promise<boolean> {
    if (!editingField) return true;
    // The confirm dialog is modal, so a second field click cannot queue another prompt.
    if (inlineDirty && !(await confirmDiscardChanges())) return false;
    closeInlineEditor();
    return true;
  }

  async function requestInlineEdit(field: OrderEditField) {
    if (editingField === field || inlineSaving) return;
    if (editingField && !(await settleInlineEdit())) return;
    setEditingField(field);
  }

  async function startFieldEdit(field: OrderEditField | null) {
    if (editingField && !(await settleInlineEdit())) return;
    setEditFocusField(field);
    setIsEditing(true);
  }

  function handleOpenChange(open: boolean) {
    if (!open && editingField && inlineDirty) {
      // Dirty inline draft: ask first; closing proceeds only when the user discards it.
      void settleInlineEdit().then((settled) => {
        if (!settled) return;
        setDetailPanelOpen(false);
        stopEditing();
        setConfirmDeleteOpen(false);
      });
      return;
    }
    setDetailPanelOpen(open);
    if (!open) {
      closeInlineEditor();
      stopEditing();
      setConfirmDeleteOpen(false);
    }
  }

  /** Click-to-edit is available exactly when the old per-field pencils were. */
  const showFieldEdit = Boolean(selectedOrder && !isEditing && canEditOrder && !closedContentLocked);
  /** Client/vehicle change is locked for cancelled orders even when other owner edits are allowed. */
  const canChangeClientVehicle = Boolean(
    showFieldEdit && selectedOrder && selectedOrder.status !== "cancelled",
  );
  const { mutateAsync: saveOrderFields, isPending: isFieldSaving } = useUpdateOrderFields();
  const { mutateAsync: saveCustomFieldValue, isPending: isCustomFieldSaving } = useUpdateOrderCustomFieldValue();
  const inlineSaving = isFieldSaving || isCustomFieldSaving;
  const { vehicle: linkedVehicle } = useGetVehicle(showClientVehicles ? selectedOrder?.vehicleId : null);
  const { fields: orderFieldConfig } = useOrderFieldConfig();
  const orderFieldMap = useMemo(() => fieldConfigMap(orderFieldConfig), [orderFieldConfig]);
  const { data: customFieldValues = [] } = useOrderCustomFieldValues(selectedOrder?.id);
  const fieldLabel = (key: string, fallback: string) => orderFieldMap.get(key)?.label ?? fallback;
  const fieldVisible = (key: string, industryDefault = true) => {
    if (!industryDefault) return false;
    const cfg = orderFieldMap.get(key);
    return cfg ? cfg.visible : true;
  };

  /** Shared wiring for every click-to-edit field (one editor open at a time). */
  const inlineCommon = (field: OrderEditField) => {
    const customKey = parseCustomEditField(field);
    const configKey = customKey ?? field;
    return {
      fieldKey: field,
      editable: showFieldEdit,
      isEditing: editingField === field,
      // Callback ref (not read during render): only the open editor exposes its imperative `save()`.
      // eslint-disable-next-line react-hooks/refs
      ref: editingField === field ? setInlineFieldHandle : undefined,
      required: orderFieldMap.get(configKey)?.required ?? false,
      saving: inlineSaving && editingField === field,
      onRequestEdit: () => void requestInlineEdit(field),
      onCancel: closeInlineEditor,
      onDirtyChange: setInlineDirty,
      onSave: (next: OrderInlineFieldValue) => saveInlineField(field, next),
    };
  };

  /** Persist one inline field. Throws (message shown under the control) on validation / API failure. */
  async function saveInlineField(field: OrderEditField, raw: OrderInlineFieldValue) {
    if (!selectedOrder) return;
    const order = selectedOrder;
    const text = typeof raw === "string" ? raw : "";

    const customKey = parseCustomEditField(field);
    if (customKey) {
      const definition = orderFieldConfig.find((item) => item.isCustom && item.key === customKey);
      if (!definition?.definitionId) throw new Error(t("common.somethingWentWrong"));
      await saveCustomFieldValue({
        orderId: order.id,
        definitionId: definition.definitionId,
        value: serializeCustomFieldValue(definition.type, raw),
      });
      closeInlineEditor();
      return;
    }

    let patch: UpdateOrderFieldsPatch;
    switch (field) {
      case "measurementAt":
      case "installationAt": {
        const [date = "", time = ""] = text.split("T");
        const iso = combineDateTimeLocal(date, time);
        if (text.trim() && !iso) throw new Error(t("common.somethingWentWrong"));
        const invalidOrder =
          field === "installationAt"
            ? isInstallationBeforeMeasurement(order.measurementAt ?? null, iso)
            : isInstallationBeforeMeasurement(iso, order.installationAt ?? null);
        if (invalidOrder) throw new Error(t("orders.validation.installationBeforeMeasurement"));
        patch = { [field]: iso };
        break;
      }
      case "vehicleCurrentMileage": {
        // Match EditOrderForm: empty never clears the vehicle reading or the order snapshot.
        const reading = parseVisitMileage(text);
        if (reading == null) {
          closeInlineEditor();
          return;
        }
        if (!linkedVehicle) throw new Error(t("vehicles.errors.notFound"));
        guardWrite();
        // Vehicle reading first — a failed vehicle write must not report the order as saved.
        await persistOrderVehicleMileage({
          workspaceId,
          clientId: linkedVehicle.clientId,
          vehicle: linkedVehicle,
          formMileage: text,
          queryClient,
        });
        patch = buildOrderMileageSnapshot(text, linkedVehicle) ?? {};
        if (Object.keys(patch).length === 0) {
          closeInlineEditor();
          return;
        }
        break;
      }
      case "description":
      case "deadline":
      case "device":
      case "carNumber":
      case "vin":
      case "deviceSerial":
      case "deviceImei":
      case "deviceCondition":
      case "deviceCompleteness":
      case "devicePasscode":
      case "siteAddress":
      case "productDimensions":
        patch = { [field]: text } as UpdateOrderFieldsPatch;
        break;
      default:
        throw new Error(t("common.somethingWentWrong"));
    }

    const updated = await saveOrderFields({ orderId: order.id, patch });
    onOrderUpdated(updated);
    closeInlineEditor();
  }

  function renderTextField(
    field: OrderEditField,
    label: string,
    current: string | null | undefined,
    options: { kind?: "text" | "textarea"; mono?: boolean; masked?: boolean } = {},
  ) {
    const kind = options.kind ?? "text";
    return (
      <OrderInlineField
        key={field}
        label={label}
        value={current?.trim() ? current : ""}
        editValue={current ?? ""}
        kind={kind}
        mono={options.mono}
        masked={options.masked}
        className={kind === "textarea" && editingField === field ? "col-span-2" : undefined}
        {...inlineCommon(field)}
      />
    );
  }

  function renderDateTimeField(field: "measurementAt" | "installationAt", label: string, iso: string | null | undefined) {
    const parts = splitDateTimeLocal(iso);
    return (
      <OrderInlineField
        key={field}
        label={label}
        value={iso ? formatIndustryDateTime(iso, i18n.language) : ""}
        editValue={parts.date ? `${parts.date}T${parts.time || "00:00"}` : ""}
        kind="datetime-local"
        {...inlineCommon(field)}
      />
    );
  }

  /** Vehicle-less assets: with edit rights an empty visible field shows a click-to-add placeholder. */
  const showAssetField = (name: "device" | "carNumber" | "vin") => {
    if (!selectedOrder) return false;
    const value = selectedOrder[name];
    const show = showFieldEdit
      ? Boolean(value?.trim()) || workflow.orderFields[name].visible
      : shouldShowOrderAssetValue(workflow.orderFields[name], value, name);
    return fieldVisible(name, show);
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

  /** «Save & close»: persists whatever is open, then closes the sheet. Stays open when the save fails. */
  async function handleSaveAndClose() {
    if (footerSaving) return;
    if (isEditing) {
      // The form's `onUpdated` already stops editing and closes the sheet on success.
      setFooterSaving(true);
      try {
        await editFormRef.current?.submit();
      } finally {
        setFooterSaving(false);
      }
      return;
    }
    if (editingField) {
      setFooterSaving(true);
      try {
        // Clean editor → closes it and resolves true; dirty → saves; validation / server error → false (stay open).
        const saved = (await inlineFieldRef.current?.save()) ?? true;
        if (!saved) return;
      } finally {
        setFooterSaving(false);
      }
    }
    closeSheet();
  }

  /** «Close order» opens the lifecycle dialog; it never closes the sheet. */
  async function handleCloseOrderClick() {
    if (!(await settleInlineEdit())) return;
    await requestClose();
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
  const { items: inventoryItemsForCost } = useGetInventoryItems("", "all", { field: "name", ascending: true });
  const purchasePriceById = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of inventoryItemsForCost) {
      if (item.purchasePrice != null && item.purchasePrice > 0) map.set(item.id, item.purchasePrice);
    }
    return map;
  }, [inventoryItemsForCost]);
  const hasServiceLines = serviceLines.length > 0;
  const hasMaterialLines = materialLines.length > 0;
  // Unified items search: services follow the content-edit gate; materials also need warehouse rights.
  const showAddService = showFieldEdit;
  const showAddMaterial = showFieldEdit && canWarehouse;
  const showAddLinesSearch = showAddService || showAddMaterial;

  function scrollServiceLineIntoView(serviceId: string) {
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-order-service-line-id="${serviceId}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  function highlightExistingServiceLine(serviceId: string) {
    setHighlightedServiceId(serviceId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedServiceId(null), 2400);
    scrollServiceLineIntoView(serviceId);
    const existing = selectedOrder?.services.find((line) => line.serviceId === serviceId && line.id);
    if (existing?.id) {
      setServiceLineEdit({ lineId: existing.id, field: "price" });
    }
  }

  function openServiceLinePriceAfterAdd(updated: Order, catalogServiceId: string) {
    const prevIds = new Set((selectedOrder?.services ?? []).map((line) => line.id).filter(Boolean));
    const created =
      updated.services.find((line) => line.serviceId === catalogServiceId && line.id && !prevIds.has(line.id)) ??
      updated.services.find((line) => line.serviceId === catalogServiceId && line.id);
    if (!created?.id) return;
    setHighlightedServiceId(catalogServiceId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedServiceId(null), 2400);
    scrollServiceLineIntoView(catalogServiceId);
    setServiceLineEdit({ lineId: created.id, field: "price" });
  }

  /**
   * Called when an inline line editor closes. The search field is deliberately NOT re-focused: a focused
   * search reopens its result list over the lines, so focus leaves the editor and lands nowhere.
   */
  function focusAddLinesSearch() {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest('[data-testid="order-items-actions"]')) active.blur();
    });
  }

  /**
   * Optimistic copy of the order with one line's unit price changed and the total recomputed the same
   * way the server does (per-line discounts included). Shown at once; the server response replaces it.
   */
  function withOptimisticLinePrice(
    order: Order,
    kind: "service" | "material",
    lineId: string,
    price: number,
    quantity?: number,
  ): Order {
    const patchLine = <T extends { id?: string }>(line: T): T =>
      line.id === lineId ? { ...line, price, ...(quantity !== undefined ? { quantity } : {}) } : line;
    const toMoney = (line: { price: number; quantity: number; discountType?: LineDiscountType | null; discountValue?: number | null }): MoneyLine => ({
      price: Number(line.price) || 0,
      qty: Number(line.quantity) || 0,
      discountType: line.discountType ?? null,
      discountValue: line.discountValue ?? null,
    });
    const services = kind === "service" ? order.services.map(patchLine) : order.services;
    const materials = kind === "material" ? (order.materials ?? []).map(patchLine) : (order.materials ?? []);
    const money = computeOrderMoney({ services: services.map(toMoney), materials: materials.map(toMoney) });
    return { ...order, services, materials, totalPrice: money.total };
  }

  async function saveServiceLineField(lineId: string, field: ServiceLineInlineField, raw: string) {
    if (!selectedOrder) return;
    if (field === "price") {
      const price = parseOrderServiceLinePrice(raw);
      if (price === "invalid") throw new Error(t("orders.form.freeformPriceInvalid"));
      // Show the new price and total immediately; the save continues in the background and a failure
      // restores the previous order and reports the error.
      const previous = selectedOrder;
      onOrderUpdated(withOptimisticLinePrice(previous, "service", lineId, price));
      void updateServiceLine
        .mutateAsync({ orderId: previous.id, lineId, patch: { price } })
        .then((updated) => onOrderUpdated(updated))
        .catch((error: unknown) => {
          onOrderUpdated(previous);
          toast.error(error instanceof Error && error.message ? error.message : t("common.somethingWentWrong"));
        });
      return;
    }
    const updated = await updateServiceLine.mutateAsync({
      orderId: selectedOrder.id,
      lineId,
      patch: { technicianId: raw.trim() ? raw.trim() : null },
    });
    onOrderUpdated(updated);
  }

  async function saveMaterialLineField(lineId: string, field: MaterialLineInlineField, raw: string) {
    if (!selectedOrder) return;
    const line = (selectedOrder.materials ?? []).find((entry) => entry.id === lineId);
    const warehouseName = line?.warehouseId
      ? warehouses.find((warehouse) => warehouse.id === line.warehouseId)?.name
      : undefined;
    if (field === "price") {
      const price = parseOrderServiceLinePrice(raw);
      if (price === "invalid") throw new Error(t("orders.errors.materialPriceInvalid"));
      const previous = selectedOrder;
      onOrderUpdated(withOptimisticLinePrice(previous, "material", lineId, price));
      void updateMaterialLine
        .mutateAsync({ orderId: previous.id, lineId, patch: { price }, warehouseName })
        .then((updated) => onOrderUpdated(updated))
        .catch((error: unknown) => {
          onOrderUpdated(previous);
          toast.error(error instanceof Error && error.message ? error.message : t("common.somethingWentWrong"));
        });
      return;
    }
    const quantity = Number(raw);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(t("orders.validation.quantityMin"));
    }
    if (!line) {
      const updated = await updateMaterialLine.mutateAsync({ orderId: selectedOrder.id, lineId, patch: { quantity }, warehouseName });
      onOrderUpdated(updated);
      return;
    }
    // The editor already blocked quantities above the warehouse stock, so a failure here is rare (a race or a
    // missing RPC): show the new quantity and total at once, save in the background, roll back on error.
    const previous = selectedOrder;
    onOrderUpdated(withOptimisticLinePrice(previous, "material", lineId, Number(line.price) || 0, quantity));
    void updateMaterialLine
      .mutateAsync({ orderId: previous.id, lineId, patch: { quantity }, warehouseName })
      .then((updated) => onOrderUpdated(updated))
      .catch((error: unknown) => {
        onOrderUpdated(previous);
        toast.error(error instanceof Error && error.message ? error.message : t("common.somethingWentWrong"));
      });
  }

  const canDeleteServiceLine = showFieldEdit;

  async function handleDeleteServiceLine(lineId: string) {
    if (!selectedOrder || !canDeleteServiceLine) return;
    const line = selectedOrder.services.find((entry) => entry.id === lineId);
    if (!line) return;
    const snapshot = { ...line };
    const previous = selectedOrder;
    // Optimistic: the row disappears and the total updates at once; the delete runs in the background.
    onOrderUpdated(withoutLine(previous, "service", lineId));
    focusAddLinesSearch();
    // Undo must run after the background delete has finished, or the re-add races the delete.
    const deletion = deleteServiceLine.mutateAsync({ orderId: previous.id, lineId });
    showOrderLineDeletedToast(async () => {
      const deleted = await deletion.then(() => true).catch(() => false);
      if (!deleted) return; // the delete failed → the line was never removed
      const restored = await appendOrderServiceLines(previous.id, [snapshot], workspaceId);
      onOrderUpdated(restored);
    });
    try {
      onOrderUpdated(await deletion);
    } catch (error) {
      onOrderUpdated(previous);
      toast.dismiss("order-line-deleted");
      toast.error(error instanceof Error && error.message ? error.message : t("common.somethingWentWrong"));
    }
  }

  async function handleDeleteMaterialLine(lineId: string) {
    if (!selectedOrder || !showFieldEdit) return;
    const line = (selectedOrder.materials ?? []).find((entry) => entry.id === lineId);
    if (!line) return;
    // Catalog deletes move warehouse stock — same bar as quantity change / issue.
    if (isCatalogOrderMaterial(line) && !canWarehouse) return;
    const snapshot = materialDraftForUndo(line);
    const previous = selectedOrder;
    onOrderUpdated(withoutLine(previous, "material", lineId));
    focusAddLinesSearch();
    const deletion = deleteMaterialLine.mutateAsync({ orderId: previous.id, lineId });
    showOrderLineDeletedToast(async () => {
      const deleted = await deletion.then(() => true).catch(() => false);
      if (!deleted) return;
      const restored = await appendOrderMaterialLines(previous.id, [snapshot], workspaceId);
      onOrderUpdated(restored);
    });
    try {
      onOrderUpdated(await deletion);
    } catch (error) {
      onOrderUpdated(previous);
      toast.dismiss("order-line-deleted");
      toast.error(error instanceof Error && error.message ? error.message : t("common.somethingWentWrong"));
    }
  }

  /** Optimistic copy of the order without one line, total recomputed like the server does. */
  function withoutLine(order: Order, kind: "service" | "material", lineId: string): Order {
    const services = kind === "service" ? order.services.filter((line) => line.id !== lineId) : order.services;
    const materials = kind === "material" ? (order.materials ?? []).filter((line) => line.id !== lineId) : (order.materials ?? []);
    return { ...order, services, materials, totalPrice: orderMoneyOf(services, materials).total };
  }

  /** Optimistic copy of the order with freshly added material drafts (no ids yet → read-only rows). */
  function withPendingMaterials(order: Order, drafts: readonly OrderMaterial[]): Order {
    const materials = [
      ...(order.materials ?? []),
      ...drafts.map((draft) => ({ ...draft, id: undefined, quantityIssued: 0, quantityReturned: 0 })),
    ];
    return { ...order, materials, totalPrice: orderMoneyOf(order.services, materials).total };
  }

  function orderMoneyOf(
    services: readonly { price: number; quantity: number; discountType?: LineDiscountType | null; discountValue?: number | null }[],
    materials: readonly { price: number; quantity: number; discountType?: LineDiscountType | null; discountValue?: number | null }[],
  ) {
    const toMoney = (line: { price: number; quantity: number; discountType?: LineDiscountType | null; discountValue?: number | null }): MoneyLine => ({
      price: Number(line.price) || 0,
      qty: Number(line.quantity) || 0,
      discountType: line.discountType ?? null,
      discountValue: line.discountValue ?? null,
    });
    return computeOrderMoney({ services: services.map(toMoney), materials: materials.map(toMoney) });
  }

  const detailVatRate = selectedOrder
    ? effectiveOrderVatRate(selectedOrder, workspaceVatRate)
    : null;
  const fallbackService = selectedOrder?.service?.trim() ?? "";
  const description = selectedOrder?.description?.trim() ?? "";
  const deadline = selectedOrder?.deadline?.trim() ?? "";
  const assigneeEmptyHint =
    !employeesError && !employeesLoading && employees && technicianOptions.length === 0
      ? t("orders.form.noLinkedTechnicians")
      : null;
  const assigneeErrorMessage =
    employeesError instanceof Error ? employeesError.message : employeesError ? t("orders.form.techniciansLoadFailed") : null;

  const feedEnabled = Boolean(detailPanelOpen && selectedOrder?.id);
  const feedComments = useGetOrderComments(selectedOrder?.id, feedEnabled);
  const feedEvents = useGetOrderEvents(selectedOrder?.id, feedEnabled);
  const feedCountReady =
    feedEnabled &&
    !feedComments.isLoading &&
    !feedEvents.isLoading &&
    !feedComments.isError &&
    !feedEvents.isError &&
    !feedComments.isUnavailable &&
    !feedEvents.isUnavailable;
  const feedItemCount = feedCountReady ? feedComments.comments.length + feedEvents.events.length : null;

  const showOrderColumn = isDesktopFeedLayout || detailTab !== "history";
  const showFeedColumn = isDesktopFeedLayout || detailTab === "history";
  // Pinned under the order column only: on phones the History tab swaps it for the feed (comment box stays free).
  const showFooter = Boolean(selectedOrder) && showOrderColumn;
  // Inline edits save on Enter/blur, so the primary «Save & close» only makes sense while something is
  // still being edited; otherwise the footer offers a plain «Close».
  const hasPendingEdit = isEditing || Boolean(editingField) || Boolean(serviceLineEdit) || Boolean(materialLineEdit);
  const canSaveAndClose = canEditOrder && !closedContentLocked && hasPendingEdit;
  const lifecycleBusy = isStatusUpdating || isUnifiedStatusUpdating;
  const showCancelAction = !isEditing && (showOpenLifecycleActions || showCancelClosedAction);
  /** Same Delete action as before, shown in the Cancel control's place after the order is cancelled. */
  const showFooterDeleteAction = Boolean(canEditOrder && !isEditing && selectedOrder && isCancelledForDelete);
  const footerSavePending = footerSaving || inlineSaving || editFormSubmitting;

  function openDeleteConfirm() {
    if (deleteBlockedReason) return;
    setConfirmDeleteOpen(true);
  }

  const filesTabActive = detailPanelOpen && detailTab === "files";
  const { attachments: orderAttachments, isFetched: attachmentsFetched } = useOrderAttachments(selectedOrder?.id, {
    enabled: filesTabActive,
  });
  const itemsCount = orderDetailItemsCount(serviceLines.length, materialLines.length);
  const detailTabs: { value: OrderDetailTab; label: string }[] = [
    { value: "info", label: t("orders.detail.tabs.info") },
    {
      value: "items",
      label: t(usesWorksAndMaterialsTabLabel(industrySlug) ? "orders.detail.tabs.itemsWorks" : "orders.detail.tabs.items", {
        count: itemsCount,
      }),
    },
    {
      value: "payments",
      label:
        linkedPaymentCount > 0
          ? t("orders.detail.tabs.paymentsWithCount", { count: linkedPaymentCount })
          : t("orders.detail.tabs.payments"),
    },
    {
      value: "files",
      label:
        attachmentsFetched && orderAttachments.length > 0
          ? t("orders.detail.tabs.filesWithCount", { count: orderAttachments.length })
          : t("orders.detail.tabs.files"),
    },
    ...(isDesktopFeedLayout
      ? []
      : [
          {
            value: "history" as const,
            label:
              feedItemCount != null
                ? t("orders.detail.tabs.historyWithCount", { count: feedItemCount })
                : t("orders.detail.tabs.history"),
          },
        ]),
  ];

  async function handleStatusSelect(value: string) {
    if (!selectedOrder || !value || value === currentUnifiedStatus?.id) return;
    const result = await changeOrderStatus(value);
    if (result.ok) return;
    const option = statusOptions.find((item) => item.id === value);
    const minPaidBlock = assertMinPaidOrExplain({
      order: selectedOrder,
      targetDefinition: option?.definition,
      netPaid: orderNetPaidForMinPaid(selectedOrder, payments),
      formatMoney,
      t,
    });
    if (minPaidBlock) {
      showMinPaidBlockedToast({
        block: minPaidBlock,
        recordPaymentLabel: t("orders.minPaid.recordPayment"),
        onRecordPayment: () => {
          selectDetailTab("payments");
          setRecordPaymentOpen(true);
        },
      });
      return;
    }
    toast.error(result.reason);
  }

  const orderFeedSection = selectedOrder ? (
    <OrderFeedSection
      orderId={selectedOrder.id}
      orderNumber={selectedOrder.orderNumber}
      enabled={detailPanelOpen}
      canComment={canEditOrder && !closedContentLocked}
      layout="panel"
    />
  ) : null;

  return (
    <Sheet open={detailPanelOpen} onOpenChange={handleOpenChange}>
      <SheetContent
        ref={sheetContentRef}
        className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-lg lg:max-w-[min(1100px,calc(100vw-2rem))]"
        onEscapeKeyDown={(event) => {
          // Esc while a field / service line / change-client dialog is active must not close the sheet.
          if (editingField || serviceLineEdit || materialLineEdit || changeClientOpen) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          // Toasts (e.g. «Deleted · Undo») live outside the sheet; clicking them must not close the order.
          const target = event.target as HTMLElement | null;
          if (target?.closest?.('[role="status"], [data-rht-toaster], [data-testid="order-line-deleted-toast"]')) {
            event.preventDefault();
          }
        }}
      >
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
                {selectedOrder?.orderNumber}
                {selectedOrder && !isEditing && (
                  <OrderStatusBadge status={selectedOrder.status} customStatus={selectedOrder.customStatus} />
                )}
                {selectedOrder?.warrantySourceOrderId && !isEditing ? (
                  <StatusBadge variant="warning">{t("orders.warranty.badge")}</StatusBadge>
                ) : null}
              </span>
              {selectedOrder && !isEditing ? (
                <OrderDetailWarrantyUnderNumber order={selectedOrder} />
              ) : null}
            </SheetTitle>
            {selectedOrder && !isEditing ? (
              <OrderDetailHeaderTotal
                order={selectedOrder}
                formatMoney={formatMoney}
                paymentStatus={paymentBalance?.status ?? selectedOrder.paymentStatus}
                workspaceVatRate={workspaceVatRate}
                worksLabel={t("orders.totalBreakdown.works")}
                materialsLabel={t("orders.detail.materials")}
                className="w-full sm:w-auto sm:max-w-[14rem]"
              />
            ) : null}
          </div>
          {selectedOrder && !isEditing && canEditOrder && !closedContentLocked && (
            <button
              type="button"
              onClick={() => void startFieldEdit(null)}
              aria-label={t("common.edit")}
              title={t("orders.detail.editTitle")}
              className="absolute top-3 right-14 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 sm:top-3.5 sm:right-12 sm:size-8"
            >
              <Pencil className="size-4" />
            </button>
          )}
          <SheetDescription className="sr-only">{copy.detailSrDescription}</SheetDescription>
        </SheetHeader>

        {selectedOrder && !isEditing ? (
          <>
            <div
              className="max-h-40 shrink-0 overflow-y-auto border-b border-border px-5 py-2"
              data-testid="order-detail-status-bar"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Label htmlFor="order-status" className="sr-only">
                  {lifecycleStatusLocked || paidStatusLocked
                    ? t("orders.actions.statusLocked")
                    : t("orders.detail.updateStatus")}
                </Label>
                {lifecycleStatusLocked ? (
                  <div id="order-status" className="flex min-w-0 items-center gap-2">
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
                      void handleStatusSelect(value);
                    }}
                    disabled={
                      !canEditOrder ||
                      isStatusUpdating ||
                      isUnifiedStatusUpdating ||
                      isAssigneeUpdating ||
                      paidStatusLocked
                    }
                  >
                    <SelectTrigger id="order-status" className="min-w-0 flex-1 basis-48 sm:max-w-xs">
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
              </div>
              {isOrderCurrentlyClosed(selectedOrder) ? (
                <div className="mt-2 space-y-0.5 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm" data-closed-order-banner>
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
              {paidStatusLocked ? (
                <p className="mt-1.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">{t("orders.actions.paidStatusImmutable")}</p>
              ) : paidStatusBlocked ? (
                <p className="mt-1.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">{t("orders.taxInvoice.paidRequiresNumber")}</p>
              ) : null}
            </div>

            <div
              className="shrink-0 border-b border-border px-5 py-1.5"
              data-testid="order-detail-tabs"
            >
              {/* Mobile widths also expose the legacy test id so existing mobile-tab lookups keep working. */}
              <div data-testid={isDesktopFeedLayout ? undefined : "order-detail-mobile-tabs"}>
                <Tabs value={detailTab} onValueChange={(value) => isOrderDetailTab(value) && selectDetailTab(value)}>
                  <TabsList className="h-auto w-full flex-nowrap justify-start overflow-x-auto">
                    {detailTabs.map((tab) => (
                      <TabsTrigger key={tab.value} value={tab.value} className="h-11 min-h-11 shrink-0">
                        {tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            </div>
          </>
        ) : null}

        {selectedOrder ? (
          <div
            className={cn("flex min-h-0 flex-1", isDesktopFeedLayout ? "flex-row" : "flex-col")}
            data-order-detail-layout={isDesktopFeedLayout ? "desktop" : "mobile"}
          >
            <div
              className={cn("min-h-0 min-w-0", showOrderColumn ? "flex flex-1 flex-col" : "hidden")}
              data-testid="order-detail-main"
              aria-hidden={!showOrderColumn}
            >
              <div className="min-h-0 flex-1 overflow-y-auto" data-testid="order-detail-scroll">
              {isEditing ? (
                <div className="space-y-5 px-5 py-5">
                  <EditOrderForm
                    ref={editFormRef}
                    key={`${selectedOrder.id}:${editFocusField ?? "top"}`}
                    onSubmittingChange={setEditFormSubmitting}
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
              ) : (
                <div className="space-y-5 px-5 py-5">
            {detailTab === "info" ? (
              <>
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

            <OrderClientCard
              order={selectedOrder}
              workflow={workflow}
              deviceLabel={fieldLabel("device", copy.deviceDetail)}
              carNumberLabel={fieldLabel("carNumber", copy.carNumberDetail)}
              vinLabel={fieldLabel("vin", copy.vinDetail)}
              interactive={canChangeClientVehicle}
              onChangeRequest={() => setChangeClientOpen(true)}
              onOpenClient={onOpenClient}
              details={
                showClientVehicles ? (
              <OrderLinkedVehicleDetails
                vehicleId={selectedOrder.vehicleId}
                vehicleMileageSnapshot={selectedOrder.vehicleMileageSnapshot ?? null}
                vehicleMileageUnitSnapshot={selectedOrder.vehicleMileageUnitSnapshot ?? null}
                onOpenRelatedOrder={(order) => {
                  onOrderUpdated(order);
                }}
                fieldConfig={orderFieldMap}
                renderRow={
                  showFieldEdit
                    ? (row) => {
                        // Only the visit mileage snapshot belongs to the order; every other vehicle value opens the vehicle card.
                        if (row.key !== "currentMileage") return undefined;
                        const snapshot = selectedOrder.vehicleMileageSnapshot ?? null;
                        return (
                          <OrderInlineField
                            label={row.label}
                            value={snapshot == null ? "" : row.value}
                            editValue={snapshot}
                            kind="number"
                            {...inlineCommon("vehicleCurrentMileage")}
                          />
                        );
                      }
                    : undefined
                }
              />
                ) : undefined
              }
            />

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
              {deadline || (showFieldEdit && fieldVisible("deadline")) ? (
                <OrderInlineField
                  label={fieldLabel("deadline", copy.deadlineDetail)}
                  value={
                    deadline ? (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 ${overdue ? "text-destructive" : ""}`}>
                          <Calendar className={`size-3.5 ${overdue ? "text-destructive" : "text-subtle-foreground"}`} />
                          {deadline}
                        </span>
                        {overdue ? <StatusBadge variant="danger">{t("orders.detail.overdue")}</StatusBadge> : null}
                      </span>
                    ) : (
                      ""
                    )
                  }
                  editValue={deadline.slice(0, 10)}
                  kind="date"
                  {...inlineCommon("deadline")}
                />
              ) : null}

              {!showClientVehicles && showAssetField("device")
                ? renderTextField("device", fieldLabel("device", copy.deviceDetail), selectedOrder.device)
                : null}
              {!showClientVehicles && showAssetField("carNumber")
                ? renderTextField("carNumber", fieldLabel("carNumber", copy.carNumberDetail), selectedOrder.carNumber)
                : null}
              {!showClientVehicles && showAssetField("vin")
                ? renderTextField("vin", fieldLabel("vin", copy.vinDetail), selectedOrder.vin, { mono: true })
                : null}
              {fieldVisible("deviceSerial", industryBlocks.deviceSerial)
                ? renderTextField(
                    "deviceSerial",
                    fieldLabel("deviceSerial", t("orders.industryFields.deviceSerial")),
                    selectedOrder.deviceSerial,
                    { mono: true },
                  )
                : null}
              {fieldVisible("deviceImei", industryBlocks.deviceImei)
                ? renderTextField(
                    "deviceImei",
                    fieldLabel("deviceImei", t("orders.industryFields.deviceImei")),
                    selectedOrder.deviceImei,
                    { mono: true },
                  )
                : null}
              {fieldVisible("deviceCondition", industryBlocks.deviceCondition)
                ? renderTextField(
                    "deviceCondition",
                    fieldLabel("deviceCondition", t("orders.industryFields.deviceCondition")),
                    selectedOrder.deviceCondition,
                    { kind: "textarea" },
                  )
                : null}
              {fieldVisible("deviceCompleteness", industryBlocks.deviceCompleteness)
                ? renderTextField(
                    "deviceCompleteness",
                    fieldLabel("deviceCompleteness", t("orders.industryFields.deviceCompleteness")),
                    selectedOrder.deviceCompleteness,
                    { kind: "textarea" },
                  )
                : null}
              {fieldVisible("devicePasscode", industryBlocks.devicePasscode)
                ? renderTextField(
                    "devicePasscode",
                    fieldLabel("devicePasscode", t("orders.industryFields.devicePasscode")),
                    selectedOrder.devicePasscode,
                    { mono: true, masked: true },
                  )
                : null}
              {fieldVisible("siteAddress", industryBlocks.siteAddress)
                ? renderTextField(
                    "siteAddress",
                    fieldLabel("siteAddress", t("orders.industryFields.siteAddress")),
                    selectedOrder.siteAddress,
                  )
                : null}
              {fieldVisible("productDimensions", industryBlocks.productDimensions)
                ? renderTextField(
                    "productDimensions",
                    fieldLabel("productDimensions", t("orders.industryFields.productDimensions")),
                    selectedOrder.productDimensions,
                  )
                : null}
              {fieldVisible("measurementAt", industryBlocks.measurementAt)
                ? renderDateTimeField(
                    "measurementAt",
                    fieldLabel("measurementAt", t("orders.industryFields.measurementAt")),
                    selectedOrder.measurementAt,
                  )
                : null}
              {fieldVisible("installationAt", industryBlocks.installationAt)
                ? renderDateTimeField(
                    "installationAt",
                    fieldLabel("installationAt", t("orders.industryFields.installationAt")),
                    selectedOrder.installationAt,
                  )
                : null}
              {orderFieldConfig
                .filter((field) => field.isCustom && field.visible)
                .map((field) => {
                  const row = customFieldValues.find((value) => value.definitionId === field.definitionId);
                  const text = displayCustomFieldValue(field.type, row?.value, field.options);
                  const editKey = customEditFieldKey(field.key);
                  const kind = customInlineKind(field.type);
                  const checked = row?.value === true || row?.value === "true";
                  return (
                    <OrderInlineField
                      key={field.key}
                      label={field.label}
                      value={field.type === "checkbox" ? (checked ? "✓" : "—") : text}
                      editValue={field.type === "checkbox" ? checked : row?.value == null ? "" : String(row.value)}
                      kind={kind}
                      options={field.options}
                      className={
                        field.type === "textarea" && editingField === editKey ? "col-span-2" : undefined
                      }
                      {...inlineCommon(editKey)}
                    />
                  );
                })}
            </dl>

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

            {description || (showFieldEdit && fieldVisible("description")) ? (
              <dl>
                <OrderInlineField
                  label={t("orders.detail.description")}
                  value={description}
                  editValue={selectedOrder.description ?? ""}
                  kind="textarea"
                  valueClassName="text-sm font-normal"
                  {...inlineCommon("description")}
                />
              </dl>
            ) : null}
              </>
            ) : null}

            {detailTab === "items" ? (
              <>
            {showAddLinesSearch && selectedOrder ? (
              <div data-testid="order-items-actions">
                <OrderAddLinesSearch
                  order={selectedOrder}
                  industrySlug={industrySlug}
                  allowServices={showAddService}
                  allowMaterials={showAddMaterial}
                  focusRegistration={(focus) => {
                    addLinesSearchFocusRef.current = focus;
                  }}
                  onServiceAdded={(updated, meta) => {
                    onOrderUpdated(updated);
                    if (meta?.catalogServiceId) openServiceLinePriceAfterAdd(updated, meta.catalogServiceId);
                  }}
                  onHighlightServiceLine={highlightExistingServiceLine}
                  onOpenMaterial={(prefill) => {
                    setAddMaterialPrefill(prefill);
                    setAddMaterialOpen(true);
                  }}
                />
              </div>
            ) : null}
            {!hasServiceLines && !hasMaterialLines ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center" data-testid="order-items-empty">
                <p className="text-sm font-medium text-foreground">{t("orders.detail.tabs.itemsEmpty")}</p>
              </div>
            ) : null}
            {hasServiceLines ? (
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
                      <th className="px-2 py-2 text-left font-medium sm:px-3">
                        {t("orders.detail.services")}
                      </th>
                      <th className="px-2 py-2 text-right font-medium sm:px-3">{t("orders.detail.quantity")}</th>
                      <th className="px-2 py-2 text-right font-medium sm:px-3">{t("orders.detail.price")}</th>
                      <th className="px-2 py-2 text-right font-medium sm:px-3">{t("orders.detail.amount")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {serviceLines.map((line, index) => {
                      const lineGross = orderLineAmount({ price: line.price, quantity: line.quantity });
                      const lineVat =
                        detailVatRate != null ? vatIncludedAmount(lineGross, detailVatRate) : null;
                      const isHighlighted = Boolean(line.serviceId && highlightedServiceId === line.serviceId);
                      const lineId = line.id?.trim() ?? "";
                      return (
                      <tr
                        key={line.id ?? `${line.serviceId}-${index}`}
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
                                    onClick={() => setCatalogServiceId(line.serviceId)}
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
                                editing={serviceLineEdit}
                                performerOptions={teamOptions}
                                saving={updateServiceLine.isPending}
                                onRequestEdit={() => {
                                  if (!lineId) return;
                                  setServiceLineEdit({ lineId, field: "performer" });
                                }}
                                onCancel={() => setServiceLineEdit(null)}
                                onSaved={() => setServiceLineEdit(null)}
                                onSaveField={async (technicianId) => {
                                  if (!lineId) return;
                                  await saveServiceLineField(lineId, "performer", technicianId);
                                }}
                                onEditorClosed={focusAddLinesSearch}
                              />
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
                            {canDeleteServiceLine && lineId ? (
                              <OrderLineDeleteButton
                                testId={`service-line-delete-${lineId}`}
                                className="self-end sm:-my-2.5 sm:self-start"
                                disabled={deleteServiceLine.isPending}
                                onClick={() => void handleDeleteServiceLine(lineId)}
                              />
                            ) : null}
                          </div>
                        </td>
                        <OrderServiceLineInlineCells
                          line={line}
                          editable={showFieldEdit}
                          editing={serviceLineEdit}
                          formatMoney={formatMoney}
                          locale={i18n.language}
                          saving={updateServiceLine.isPending}
                          amountNode={
                            <>
                              <div>{formatMoney(lineGross)}</div>
                              {lineVat != null ? (
                                <div className="text-[11px] text-muted-foreground">
                                  {t("orders.vat.included")}: {formatMoney(lineVat)}
                                </div>
                              ) : null}
                            </>
                          }
                          onRequestEdit={(field) => {
                            if (!lineId) return;
                            setServiceLineEdit({ lineId, field });
                          }}
                          onCancel={() => setServiceLineEdit(null)}
                          onSaved={() => setServiceLineEdit(null)}
                          onSaveField={async (field, raw) => {
                            if (!lineId) return;
                            await saveServiceLineField(lineId, field, raw);
                          }}
                          onTabFromPrice={() => {
                            if (!lineId) return;
                            setServiceLineEdit({ lineId, field: "performer" });
                          }}
                          onEditorClosed={focusAddLinesSearch}
                        />
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
              />
            ) : null}

            {hasMaterialLines ? (
              <div className="space-y-3">
                <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-border">
                  {/* Fixed layout only from sm: on phones the auto layout keeps the money cells readable. */}
                  <table className="w-full text-sm sm:table-fixed">
                    {/* The open quantity editor carries the stock hint / warning: give that column more room. */}
                    {materialLineEdit?.field === "quantity" ? (
                      <colgroup>
                        <col className="w-[32%]" />
                        <col className="w-[34%]" />
                        <col className="w-[17%]" />
                        <col className="w-[17%]" />
                      </colgroup>
                    ) : (
                      <colgroup>
                        <col className="w-[42%]" />
                        <col className="w-[16%]" />
                        <col className="w-[22%]" />
                        <col className="w-[20%]" />
                      </colgroup>
                    )}
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium sm:px-3">
                          {t("orders.detail.materials")}
                        </th>
                        <th className="px-2 py-2 text-right font-medium sm:px-3">{t("orders.detail.quantity")}</th>
                        <th className="px-2 py-2 text-right font-medium sm:px-3">{t("orders.detail.price")}</th>
                        <th className="px-2 py-2 text-right font-medium sm:px-3">{t("orders.detail.amount")}</th>
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
                        const lineId = line.id?.trim() ?? "";
                        const warehouseName = line.warehouseId
                          ? warehouses.find((warehouse) => warehouse.id === line.warehouseId)?.name
                          : undefined;
                        const purchase = line.inventoryItemId ? purchasePriceById.get(line.inventoryItemId) : undefined;
                        return (
                          <tr key={line.id ?? `${line.inventoryItemId ?? "free"}-${index}`}>
                            <td className="px-2 py-2 [overflow-wrap:anywhere] text-foreground sm:px-3">
                              <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:justify-between">
                                <div className="min-w-0 flex-1 space-y-1">
                                  <p>
                                    {catalog && line.inventoryItemId ? (
                                      <button
                                        type="button"
                                        className="text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none [overflow-wrap:anywhere]"
                                        onClick={() => setCatalogInventoryId(line.inventoryItemId ?? null)}
                                        title={t("orders.catalogLink.openMaterial")}
                                      >
                                        {line.itemName}
                                      </button>
                                    ) : (
                                      line.itemName
                                    )}
                                  </p>
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
                                {showFieldEdit && lineId && (!catalog || canWarehouse) ? (
                                  <OrderLineDeleteButton
                                    testId={`material-line-delete-${lineId}`}
                                className="self-end sm:-my-2.5 sm:self-start"
                                    disabled={deleteMaterialLine.isPending}
                                    onClick={() => void handleDeleteMaterialLine(lineId)}
                                  />
                                ) : null}
                              </div>
                            </td>
                            <OrderMaterialLineInlineCells
                              line={line}
                              editable={showFieldEdit}
                              editing={materialLineEdit}
                              formatMoney={formatMoney}
                              locale={i18n.language}
                              saving={updateMaterialLine.isPending}
                              purchasePrice={purchase}
                              warehouseName={warehouseName}
                              warehouseOnHand={
                                isCatalogOrderMaterial(line) && line.warehouseId && line.inventoryItemId
                                  ? resolveCatalogLineStockLimit({
                                      line,
                                      lines: selectedOrder.materials ?? [],
                                      stock: warehouseStock,
                                      exclude: { lineId: line.id },
                                    })?.warehouseOnHand
                                  : null
                              }
                              maxQuantity={
                                isCatalogOrderMaterial(line) && line.warehouseId && line.inventoryItemId
                                  ? resolveCatalogLineStockLimit({
                                      line,
                                      lines: selectedOrder.materials ?? [],
                                      stock: warehouseStock,
                                      exclude: { lineId: line.id },
                                    })?.max
                                  : null
                              }
                              amountNode={
                                <>
                                  <div>{formatMoney(lineGross)}</div>
                                  {lineVat != null ? (
                                    <div className="text-[11px] text-muted-foreground">
                                      {t("orders.vat.included")}: {formatMoney(lineVat)}
                                    </div>
                                  ) : null}
                                </>
                              }
                              onRequestEdit={(field) => {
                                if (!lineId) return;
                                setMaterialLineEdit({ lineId, field });
                              }}
                              onCancel={() => setMaterialLineEdit(null)}
                              onSaved={() => setMaterialLineEdit(null)}
                              onSaveField={async (field, raw) => {
                                if (!lineId) return;
                                await saveMaterialLineField(lineId, field, raw);
                              }}
                              onEditorClosed={focusAddLinesSearch}
                              onSetQuantityToMax={(max) => {
                                if (!lineId) return;
                                void saveMaterialLineField(lineId, "quantity", String(max))
                                  .then(() => setMaterialLineEdit(null))
                                  .catch((error: unknown) => {
                                    // The editor stays open; surface the failure instead of swallowing it.
                                    toast.error(error instanceof Error ? error.message : t("common.somethingWentWrong"));
                                  });
                              }}
                            />
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
              </>
            ) : null}

            {detailTab === "payments" ? (
              <>
            <PaymentHistorySection
              target="order"
              order={selectedOrder}
              fullOrder={selectedOrder}
              onOrderUpdated={onOrderUpdated}
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
              </>
            ) : null}

            {detailTab === "files" ? (
              <OrderAttachmentsSection
                orderId={selectedOrder.id}
                enabled={filesTabActive}
                canMutateOverride={closedContentLocked ? false : undefined}
              />
            ) : null}

            {detailTab === "info" ? (
              <>
            {(selectedOrder.createdAt || selectedOrder.updatedAt) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle-foreground tabular-nums">
                {selectedOrder.createdAt ? <p>{t("orders.detail.created", { date: selectedOrder.createdAt })}</p> : null}
                {selectedOrder.updatedAt ? <p>{t("orders.detail.updated", { date: selectedOrder.updatedAt })}</p> : null}
              </div>
            )}
              </>
            ) : null}
                </div>
              )}
              </div>

              {showFooter ? (
                <footer
                  data-testid="order-detail-footer"
                  className={cn(
                    "shrink-0 border-t border-border bg-background px-5 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]",
                    // Phones: two rows so labels are never truncated —
                    // row 1 «Сохранить и закрыть» full width, row 2 «Закрыть заказ» + ⋯.
                    isDesktopFeedLayout ? "flex flex-wrap items-center justify-end gap-2" : "grid grid-cols-[1fr_auto] gap-2",
                  )}
                >
                  {isDesktopFeedLayout && showCancelAction ? (
                    <div className="mr-auto flex min-w-0 max-w-full flex-col gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 self-start text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setCancelOpen(true)}
                        disabled={lifecycleBusy}
                      >
                        <CircleX />
                        {t("orders.lifecycle.cancelAction")}
                      </Button>
                      <p
                        className="text-xs text-destructive [overflow-wrap:anywhere]"
                        data-testid="order-detail-cancel-delete-hint"
                      >
                        {t("orders.lifecycle.cancelDeleteHint")}
                      </p>
                    </div>
                  ) : null}

                  {isDesktopFeedLayout && showFooterDeleteAction ? (
                    <div className="mr-auto flex min-w-0 max-w-full flex-col gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={Boolean(deleteBlockedReason) || deleteOrder.isPending}
                        title={deleteBlockedReason ?? undefined}
                        onClick={openDeleteConfirm}
                      >
                        <Trash2 className="size-4 shrink-0" />
                        <span className="truncate">{t("orders.actions.delete")}</span>
                      </Button>
                      {deleteBlockedReason ? (
                        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{deleteBlockedReason}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {showOpenLifecycleActions && !isEditing ? (
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "min-h-11",
                        !isDesktopFeedLayout && "w-full min-w-0",
                        !isDesktopFeedLayout && !showCancelAction && !showFooterDeleteAction && "col-span-2",
                      )}
                      onClick={() => void handleCloseOrderClick()}
                      disabled={lifecycleBusy || footerSavePending}
                    >
                      <Lock />
                      <span className="truncate">{t("orders.lifecycle.closeAction")}</span>
                    </Button>
                  ) : null}

                  {canSaveAndClose ? (
                    <Button
                      type="button"
                      className={cn("min-h-11", !isDesktopFeedLayout && "order-first col-span-2 w-full min-w-0")}
                      loading={footerSavePending}
                      onClick={() => void handleSaveAndClose()}
                    >
                      <span className="truncate">{t("orders.detail.saveAndClose")}</span>
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      className={cn("min-h-11", !isDesktopFeedLayout && "order-first col-span-2 w-full min-w-0")}
                      onClick={closeSheet}
                    >
                      <span className="truncate">{t("orders.detail.closeWindow")}</span>
                    </Button>
                  )}

                  {!isDesktopFeedLayout && (showCancelAction || showFooterDeleteAction) ? (
                    <div className="flex min-w-0 flex-col items-end gap-1">
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-11 shrink-0"
                            aria-label={t("common.actions")}
                            disabled={lifecycleBusy || (showFooterDeleteAction && deleteOrder.isPending)}
                          >
                            <EllipsisVertical />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" side="top">
                          {showCancelAction ? (
                            <DropdownMenuItem
                              className="min-h-11 text-destructive focus:text-destructive"
                              onSelect={() => setCancelOpen(true)}
                            >
                              <CircleX />
                              {t("orders.lifecycle.cancelAction")}
                            </DropdownMenuItem>
                          ) : null}
                          {showFooterDeleteAction ? (
                            <DropdownMenuItem
                              className="min-h-11 text-destructive focus:text-destructive"
                              disabled={Boolean(deleteBlockedReason) || deleteOrder.isPending}
                              title={deleteBlockedReason ?? undefined}
                              onSelect={() => {
                                if (deleteBlockedReason || deleteOrder.isPending) return;
                                openDeleteConfirm();
                              }}
                            >
                              <Trash2 />
                              {t("orders.actions.delete")}
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {showCancelAction ? (
                        <p
                          className="max-w-[11rem] text-right text-xs text-destructive [overflow-wrap:anywhere]"
                          data-testid="order-detail-cancel-delete-hint"
                        >
                          {t("orders.lifecycle.cancelDeleteHint")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </footer>
              ) : null}
            </div>

            <div
              className={cn(
                "min-h-0 min-w-0",
                isDesktopFeedLayout
                  ? "flex w-[min(100%,380px)] shrink-0 flex-col border-l border-border bg-muted/20"
                  : showFeedColumn
                    ? "flex min-h-0 flex-1 flex-col bg-muted/20"
                    : "hidden",
              )}
              data-testid="order-detail-feed-column"
              aria-hidden={!showFeedColumn}
            >
              {orderFeedSection}
            </div>
          </div>
        ) : null}
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

      <ChangeOrderClientDialog
        order={selectedOrder}
        open={changeClientOpen}
        onOpenChange={setChangeClientOpen}
        hasInvoice={hasInvoice}
        portalContainer={sheetContentRef.current}
        onChanged={onOrderUpdated}
      />

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
      {selectedOrder ? (
        <AddOrderMaterialDialog
          open={addMaterialOpen && showAddMaterial}
          onOpenChange={(open) => {
            setAddMaterialOpen(open);
            if (!open) setAddMaterialPrefill(null);
          }}
          order={selectedOrder}
          onAdded={onOrderUpdated}
          onPending={(drafts) => {
            const previous = selectedOrder;
            onOrderUpdated(withPendingMaterials(previous, drafts));
            return () => onOrderUpdated(previous);
          }}
          prefill={addMaterialPrefill}
        />
      ) : null}
      <OrderCatalogLinkDialogs
        serviceId={catalogServiceId}
        inventoryItemId={catalogInventoryId}
        onCloseService={() => setCatalogServiceId(null)}
        onCloseInventory={() => setCatalogInventoryId(null)}
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
  const { workflow } = useIndustryWorkflow();
  const showWarrantyKm = industryUsesMileageWarranty(workflow);
  const { byOrderId } = useOrdersWarrantyIndicators([order], { useMileageWarranty: showWarrantyKm });
  return <OrderWarrantyIndicator model={byOrderId.get(order.id)} className="mt-1 font-normal" />;
}

function customInlineKind(type: string): OrderInlineFieldKind {
  switch (type) {
    case "textarea":
    case "number":
    case "date":
    case "select":
    case "checkbox":
      return type;
    case "datetime":
      return "datetime-local";
    default:
      return "text";
  }
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

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">
        <span className="min-w-0">{label}</span>
      </dt>
      <dd className="mt-1 font-medium [overflow-wrap:anywhere] text-foreground">{value}</dd>
    </div>
  );
}
