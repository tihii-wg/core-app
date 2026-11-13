import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import type { Order, OrderStatus } from "../../../lib/types";
import type { EditOrderFormHandle } from "../EditOrderForm";
import type { AddOrderMaterialPrefill } from "../AddOrderMaterialDialog";
import type { ServiceLineInlineEditTarget } from "../OrderServiceLineInlineCells";
import type { MaterialLineInlineEditTarget } from "../OrderMaterialLineInlineCells";
import { useGetWarehouses } from "../../warehouses/useGetWarehouses";
import { useGetWarehouseStock } from "../../warehouses/useGetWarehouseStock";
import { fieldConfigMap, useOrderCustomFieldValues, useOrderFieldConfig } from "../useOrderFieldConfig";
import { useGetVehicle } from "../../vehicles/useGetVehicle";
import type { OrderEditField } from "../orderEditFields";
import { industrySupportsClientVehicles, industryUsesMileageWarranty } from "../../industries/industryCapabilities";
import { industryProfile } from "../../industries/industryProfile";
import { shouldShowOrderAssetValue } from "../../industries/industryWorkflow";
import { useIndustryWorkflow } from "../../industries/useIndustryWorkflow";
import { useWorkspaceMoney } from "../../workspaces/useWorkspaceMoney";
import { useWorkspaceVatRate } from "../../finance/useWorkspaceVatRate";
import { useActiveWorkspaceRole } from "../../workspaces/useActiveWorkspaceRole";
import { canManageServices, canManageWarehouse } from "../../workspaces/workspaceRoles";
import { useWorkspaceSubscription } from "../../workspaces/useWorkspaceSubscription";
import { withSubscriptionWriteAccess } from "../../workspaces/workspaceSubscription";
import useGetEmployees from "../../employees/useGetEmployees";
import { assignableTeamOptions, assignableTechnicians } from "../assignableTechnicians";
import { useUpdateOrder } from "../useUpdateOrder";
import { useDeleteOrder } from "../useDeleteOrder";
import { useActiveWorkspaceId } from "../../profiles/useGetProfile";
import { useGetWorkspace } from "../../workspaces/useGetWorkspace";
import { useIsWorkspaceOwnerId } from "../../workspaces/useIsWorkspaceOwnerId";
import {
  peekOrderDetailTab,
  readOrderDetailTabOnOpen,
  writeOrderDetailTab,
  type OrderDetailTab,
} from "../orderDetailTabs";
import { orderPaymentBalance } from "../../finance/paymentCalculations";
import { useGetPayments } from "../../finance/usePayments";
import { useGetStatusDefinitions } from "../../statuses/useGetStatusDefinitions";
import { useOrderStatusChange } from "../useOrderStatusChange";
import { canMutateOrderContent } from "../closedOrderPermissions";
import { useClosedOrderActionPermissions } from "../useClosedOrderPermissions";
import { useConfirm } from "../../../ui/ConfirmProvider";
import { useOrderInlineEditors } from "./useOrderInlineEditors";
import { useOrderDetailModelView } from "./useOrderDetailModelView";
import { computeOrderDetailLifecycleFlags } from "./orderDetailLifecycleFlags";

export type OrderDetailPanelProps = {
  selectedOrder: Order | null;
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
  onOrderUpdated: (order: Order) => void;
  onStatusChange: (status: OrderStatus) => void;
  isStatusUpdating?: boolean;
  invoiceNumber?: string;
  onDeleted?: (orderId: string) => void;
  onOpenClient?: (clientId: string) => void;
};

export function useOrderDetailModel({
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
  const { t } = useTranslation();
  const confirm = useConfirm();
  const sheetContentRef = useRef<HTMLDivElement | null>(null);
  const [changeClientOpen, setChangeClientOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  /** Field currently open in its click-to-edit editor (only one at a time). */
  const [editingField, setEditingField] = useState<OrderEditField | null>(null);
  /** Mirrors the active inline editor's dirty state (reported by OrderInlineField). */
  const [inlineDirty, setInlineDirty] = useState(false);
  const [editFocusField, setEditFocusField] = useState<OrderEditField | null>(null);
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
  const addLinesSearchFocusRef = useRef<(() => void) | null>(null);
  const settleInlineEditRef = useRef<( () => Promise<boolean>) | null>(null);
  const closeInlineEditorRef = useRef<(() => void) | null>(null);

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
    if (tab !== detailTab && editingField && !(await settleInlineEditRef.current!())) return;
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
  /** order_services.id opened in the single-line edit dialog (pencil on the items tab). */
  const [editServiceLineId, setEditServiceLineId] = useState<string | null>(null);
  /** order_materials.id opened in the single-line edit dialog (pencil on the items tab). */
  const [editMaterialLineId, setEditMaterialLineId] = useState<string | null>(null);
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
      workspaceRole: closedOrderPerms.role,
      grants: closedOrderPerms.grants,
    });
  const closedContentLocked = selectedOrder != null && !canMutateContent;
  const assignedEmployeeId = selectedOrder?.assignedEmployeeId;
  const orderTeam = selectedOrder?.team;
  const orderServices = selectedOrder?.services;
  // Memoized so the performer selects on every line row keep the same options array between renders.
  const technicianOptions = useMemo(
    () => assignableTechnicians(employees, assignedEmployeeId),
    [employees, assignedEmployeeId],
  );
  const teamOptionsKey = [
    ...(orderTeam ?? []).map((member) => `${member.employeeId}:${member.name}`),
    ...(orderServices ?? []).map((line) => `${line.technicianId ?? ""}:${line.technicianName ?? ""}`),
  ].join("|");
  const teamOptions = useMemo(
    () =>
      assignableTeamOptions(employees, assignedEmployeeId, [
        ...(orderTeam ?? []).map((member) => ({ id: member.employeeId, name: member.name })),
        ...(orderServices ?? []).map((line) => ({ id: line.technicianId, name: line.technicianName })),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- teamOptionsKey captures team/services content
    [employees, assignedEmployeeId, teamOptionsKey],
  );
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
  const {
    hasInvoice,
    isCancelledForDelete,
    deleteBlockedReason,
    showOpenLifecycleActions,
    showCancelClosedAction,
    linkedPaymentCount,
  } = computeOrderDetailLifecycleFlags({
    selectedOrder,
    invoiceNumber,
    payments,
    orderStatusDefinitions,
    canEditOrder,
    workspaceRole,
    closedOrderPerms,
    isOwnerByOwnerId,
    t,
  });

  if (selectedOrder?.id !== editingOrderId) {
    setEditingOrderId(selectedOrder?.id);
    setIsEditing(false);
    setEditFocusField(null);
    setEditingField(null);
    setAddMaterialOpen(false);
    setAddMaterialPrefill(null);
    setServiceLineEdit(null);
    setEditServiceLineId(null);
  }

  function stopEditing() {
    setIsEditing(false);
    setEditFocusField(null);
    setEditFormSubmitting(false);
  }

  /** Closes the sheet itself (never the order lifecycle) and drops any editor state. */
  function closeSheet() {
    setDetailPanelOpen(false);
    closeInlineEditorRef.current!();
    stopEditing();
    setConfirmDeleteOpen(false);
  }

  async function startFieldEdit(field: OrderEditField | null) {
    if (editingField && !(await settleInlineEditRef.current!())) return;
    setEditFocusField(field);
    setIsEditing(true);
  }

  function handleOpenChange(open: boolean) {
    if (!open && editingField && inlineDirty) {
      // Dirty inline draft: ask first; closing proceeds only when the user discards it.
      void settleInlineEditRef.current!().then((settled) => {
        if (!settled) return;
        setDetailPanelOpen(false);
        stopEditing();
        setConfirmDeleteOpen(false);
      });
      return;
    }
    setDetailPanelOpen(open);
    if (!open) {
      closeInlineEditorRef.current!();
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

  const {
    inlineFieldRef,
    inlineSaving,
    closeInlineEditor,
    settleInlineEdit,
    inlineCommon,
    renderTextField,
    renderDateTimeField,
  } = useOrderInlineEditors({
    selectedOrder,
    showFieldEdit,
    orderFieldMap,
    orderFieldConfig,
    linkedVehicle,
    workspaceId,
    onOrderUpdated,
    editingField,
    setEditingField,
    inlineDirty,
    setInlineDirty,
  });

  settleInlineEditRef.current = settleInlineEdit;
  closeInlineEditorRef.current = closeInlineEditor;

  /** Vehicle-less assets: with edit rights an empty visible field shows a click-to-add placeholder. */
  const showAssetField = (name: "device" | "carNumber" | "vin") => {
    if (!selectedOrder) return false;
    const value = selectedOrder[name];
    const show = showFieldEdit
      ? Boolean(value?.trim()) || workflow.orderFields[name].visible
      : shouldShowOrderAssetValue(workflow.orderFields[name], value, name);
    return fieldVisible(name, show);
  };


  return useOrderDetailModelView({
    selectedOrder,
    detailPanelOpen,
    setDetailPanelOpen,
    onOrderUpdated,
    isStatusUpdating,
    onDeleted,
    onOpenClient,
    confirm,
    sheetContentRef,
    changeClientOpen,
    setChangeClientOpen,
    isEditing,
    editingField,
    setEditingField,
    editFocusField,
    editFormRef,
    editFormSubmitting,
    setEditFormSubmitting,
    footerSaving,
    setFooterSaving,
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    closeOpen,
    setCloseOpen,
    cancelOpen,
    setCancelOpen,
    recordPaymentOpen,
    setRecordPaymentOpen,
    addMaterialOpen,
    setAddMaterialOpen,
    addMaterialPrefill,
    setAddMaterialPrefill,
    highlightedServiceId,
    setHighlightedServiceId,
    serviceLineEdit,
    setServiceLineEdit,
    materialLineEdit,
    setMaterialLineEdit,
    addLinesSearchFocusRef,
    isDesktopFeedLayout,
    detailTab,
    selectDetailTab,
    formatMoney,
    workspaceVatRate,
    workflow,
    copy,
    industrySlug,
    canEditOrder,
    closedContentLocked,
    canWarehouse,
    canOpenServiceForm,
    showWarrantyKm,
    showClientVehicles,
    taxInvoiceRequired,
    technicianOptions,
    teamOptions,
    payments,
    paymentsLoading,
    statusOptions,
    currentUnifiedStatus,
    changeOrderStatus,
    isUnifiedStatusUpdating,
    paidStatusLocked,
    lifecycleStatusLocked,
    paidStatusBlocked,
    paymentBalance,
    deleteOrder,
    hasInvoice,
    isCancelledForDelete,
    deleteBlockedReason,
    showOpenLifecycleActions,
    showCancelClosedAction,
    linkedPaymentCount,
    stopEditing,
    closeSheet,
    startFieldEdit,
    handleOpenChange,
    showFieldEdit,
    canChangeClientVehicle,
    orderFieldConfig,
    orderFieldMap,
    customFieldValues,
    fieldLabel,
    fieldVisible,
    inlineSaving,
    inlineCommon,
    renderTextField,
    renderDateTimeField,
    showAssetField,
    industryBlocks,
    warehouses,
    warehouseStock,
    employeesError,
    employeesLoading,
    employees,
    isAssigneeUpdating,
    updateOrder,
    inlineFieldRef,
    catalogServiceId,
    setCatalogServiceId,
    catalogInventoryId,
    setCatalogInventoryId,
    editServiceLineId,
    setEditServiceLineId,
    editMaterialLineId,
    setEditMaterialLineId,
    settleInlineEdit,
  });
}
