import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useGetInventoryItems } from "../../inventory/useGetInventoryItems";
import { effectiveOrderVatRate } from "../../finance/orderVat";
import { isOrderOverdue } from "../orderVisibility";
import { localDateKey } from "../../../pages/dashboardStats";
import type { OrderTeamMemberInput } from "../orderTeam";
import { useGetOrderComments, useGetOrderEvents } from "../useOrderFeed";
import { assertMinPaidOrExplain, orderNetPaidForMinPaid } from "../minPaidStatusGuard";
import { showMinPaidBlockedToast } from "../showMinPaidBlockedToast";
import { useOrderAttachments } from "../useOrderAttachments";
import { prepareOrderForCloseOrPayment } from "../requestCloseOrder";
import { useConfirmOrderMileageBeforeClose } from "../useConfirmOrderMileageBeforeClose";
import type { OrderStaticContextValue, OrderEditingContextValue } from "./OrderDetailContext";
import { useOrderLineActions } from "./useOrderLineActions";
import { estimateCardVisibility, isEstimateOrder } from "../orderEstimates";
import { useConvertEstimateToOrder } from "../useEstimateMutations";
import { buildOrderDetailTabs } from "./buildOrderDetailTabs";
import { updateOrderAssignee, updateOrderTeam } from "./orderAssigneeUpdates";

/** Completes the order-detail view model after permissions / inline editors are ready. */
export function useOrderDetailModelView(ctx: Record<string, any>) {
  const { t, i18n } = useTranslation();
  const mileageConfirm = useConfirmOrderMileageBeforeClose();
  const convertEstimate = useConvertEstimateToOrder();
  const {
    selectedOrder,
    detailPanelOpen,
    onOrderUpdated,
    isStatusUpdating,
    confirm,
    isEditing,
    editingField,
    editFormRef,
    footerSaving,
    setFooterSaving,
    setCloseOpen,
    setRecordPaymentOpen,
    setHighlightedServiceId,
    setServiceLineEdit,
    setMaterialLineEdit,
    serviceLineEdit,
    materialLineEdit,
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
    canChangeClientVehicle,
    payments,
    statusOptions,
    currentUnifiedStatus,
    changeOrderStatus,
    isUnifiedStatusUpdating,
    deleteOrder,
    isCancelledForDelete,
    deleteBlockedReason,
    showOpenLifecycleActions,
    showCancelClosedAction,
    linkedPaymentCount,
    stopEditing,
    showFieldEdit,
    inlineSaving,
    inlineFieldRef,
    warehouses,
    employeesError,
    employeesLoading,
    employees,
    technicianOptions,
    isAssigneeUpdating,
    updateOrder,
    setConfirmDeleteOpen,
    setCatalogServiceId,
    setCatalogInventoryId,
    catalogServiceId,
    catalogInventoryId,
    editServiceLineId,
    setEditServiceLineId,
    editMaterialLineId,
    setEditMaterialLineId,
    settleInlineEdit,
    closeSheet,
  } = ctx;

  async function requestClose() {
    if (!selectedOrder || isStatusUpdating || isUnifiedStatusUpdating) return;
    const prepared = await prepareOrderForCloseOrPayment({ order: selectedOrder, confirm, t });
    if (!prepared) return;
    if (prepared !== selectedOrder) {
      onOrderUpdated(prepared);
      stopEditing();
    }
    const afterMileage = await mileageConfirm.ensureConfirmed(prepared);
    if (!afterMileage) return;
    if (afterMileage !== prepared) onOrderUpdated(afterMileage);
    setCloseOpen(true);
  }

  async function handleSaveAndClose() {
    if (footerSaving) return;
    if (isEditing) {
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
        const saved = (await inlineFieldRef.current?.save()) ?? true;
        if (!saved) return;
      } finally {
        setFooterSaving(false);
      }
    }
    closeSheet();
  }

  async function handleCloseOrderClick() {
    if (!(await settleInlineEdit())) return;
    await requestClose();
  }

  async function handleAssigneeChange(assignedEmployeeId: string) {
    if (!selectedOrder) return;
    await updateOrderAssignee({
      selectedOrder,
      assignedEmployeeId,
      isAssigneeUpdating,
      closedContentLocked,
      updateOrder,
      onOrderUpdated,
    });
  }

  async function handleTeamChange(team: OrderTeamMemberInput[]) {
    if (!selectedOrder) return;
    await updateOrderTeam({
      selectedOrder,
      team,
      isAssigneeUpdating,
      closedContentLocked,
      updateOrder,
      onOrderUpdated,
    });
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
  const warehouseNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const warehouse of warehouses) {
      map.set(warehouse.id, warehouse.name);
    }
    return map;
  }, [warehouses]);
  const hasServiceLines = serviceLines.length > 0;
  const hasMaterialLines = materialLines.length > 0;
  const showAddService = showFieldEdit;
  const showAddMaterial = showFieldEdit && canWarehouse;
  const showAddLinesSearch = showAddService || showAddMaterial;

  const {
    focusAddLinesSearch,
    highlightExistingServiceLine,
    incrementExistingMaterialLine,
    openServiceLinePriceAfterAdd,
    saveServiceLineField,
    saveMaterialLineField,
    handleDeleteServiceLine,
    handleDeleteMaterialLine,
    applyPendingMaterials,
    updateServiceLinePending,
    updateMaterialLinePending,
    deleteServiceLinePending,
    deleteMaterialLinePending,
  } = useOrderLineActions({
    order: selectedOrder,
    onOrderUpdated,
    canEditLines: showFieldEdit,
    canWarehouse,
    setServiceLineEdit,
    setMaterialLineEdit,
    setHighlightedServiceId,
  });

  const canDeleteServiceLine = showFieldEdit;
  const detailVatRate = selectedOrder ? effectiveOrderVatRate(selectedOrder, workspaceVatRate) : null;
  const fallbackService = selectedOrder?.service?.trim() ?? "";
  const description = selectedOrder?.description?.trim() ?? "";
  const deadline = selectedOrder?.deadline?.trim() ?? "";
  const assigneeEmptyHint =
    !employeesError && !employeesLoading && employees && technicianOptions.length === 0
      ? t("orders.form.noLinkedTechnicians")
      : null;
  const assigneeErrorMessage =
    employeesError instanceof Error
      ? employeesError.message
      : employeesError
        ? t("orders.form.techniciansLoadFailed")
        : null;

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
  const showFooter = Boolean(selectedOrder) && showOrderColumn;
  const hasPendingEdit = isEditing || Boolean(editingField) || Boolean(serviceLineEdit) || Boolean(materialLineEdit);
  const canSaveAndClose = canEditOrder && !closedContentLocked && hasPendingEdit;
  const lifecycleBusy = isStatusUpdating || isUnifiedStatusUpdating;
  const showCancelAction = !isEditing && (showOpenLifecycleActions || showCancelClosedAction);
  const showFooterDeleteAction = Boolean(canEditOrder && !isEditing && selectedOrder && isCancelledForDelete);
  const footerSavePending = footerSaving || inlineSaving || ctx.editFormSubmitting;

  const staticContextValue = useMemo<OrderStaticContextValue | null>(() => {
    if (!selectedOrder) return null;
    return {
      selectedOrder,
      formatMoney,
      workspaceVatRate,
      workflow,
      copy,
      industrySlug: industrySlug ?? "",
      canEditOrder,
      closedContentLocked,
      showFieldEdit,
      canWarehouse,
      canOpenServiceForm,
      canChangeClientVehicle,
      showWarrantyKm,
      onOrderUpdated,
      locale: i18n.language,
    };
  }, [
    selectedOrder,
    formatMoney,
    workspaceVatRate,
    workflow,
    copy,
    industrySlug,
    canEditOrder,
    closedContentLocked,
    showFieldEdit,
    canWarehouse,
    canOpenServiceForm,
    canChangeClientVehicle,
    showWarrantyKm,
    onOrderUpdated,
    i18n.language,
  ]);

  const editingContextValue = useMemo<OrderEditingContextValue>(
    () => ({
      editingField,
      serviceLineEdit,
      materialLineEdit,
      setEditingField: ctx.setEditingField,
      setServiceLineEdit,
      setMaterialLineEdit,
      highlightedServiceId: ctx.highlightedServiceId,
    }),
    [editingField, serviceLineEdit, materialLineEdit, ctx.highlightedServiceId, ctx.setEditingField],
  );

  function openDeleteConfirm() {
    if (deleteBlockedReason) return;
    setConfirmDeleteOpen(true);
  }

  const filesTabActive = detailPanelOpen && detailTab === "files";
  const { attachments: orderAttachments, isFetched: attachmentsFetched } = useOrderAttachments(selectedOrder?.id, {
    enabled: filesTabActive,
  });
  const serviceLineCount = serviceLines.length;
  const materialLineCount = materialLines.length;
  const attachmentCount = orderAttachments.length;
  const cardVisibility = estimateCardVisibility(selectedOrder);
  const detailTabs = useMemo(
    () =>
      buildOrderDetailTabs({
        t,
        industrySlug,
        serviceLineCount,
        materialLineCount,
        linkedPaymentCount,
        attachmentsFetched,
        attachmentCount,
        isDesktopFeedLayout,
        feedItemCount,
        showPayments: cardVisibility.showPayments,
      }),
    [
      t,
      industrySlug,
      serviceLineCount,
      materialLineCount,
      linkedPaymentCount,
      attachmentsFetched,
      attachmentCount,
      isDesktopFeedLayout,
      feedItemCount,
      cardVisibility.showPayments,
    ],
  );

  async function confirmConvertEstimate(): Promise<boolean> {
    return confirm({
      title: t("orders.estimates.convertConfirmTitle"),
      description: t("orders.estimates.convertConfirmBody"),
      confirmLabel: t("orders.estimates.convertConfirmAction"),
    });
  }

  async function handleConvertEstimate() {
    if (!selectedOrder || !isEstimateOrder(selectedOrder)) return;
    if (!(await confirmConvertEstimate())) return;
    try {
      const next = await convertEstimate.mutateAsync(selectedOrder.id);
      onOrderUpdated(next);
    } catch {
      // toast from mutation
    }
  }

  async function handleStatusSelect(value: string) {
    if (!selectedOrder || !value || value === currentUnifiedStatus?.id) return;
    const option = statusOptions.find((item: { id: string; semanticAction?: string | null; systemStatus?: string }) => item.id === value);
    if (isEstimateOrder(selectedOrder) && option?.semanticAction === "accept") {
      if (!(await confirmConvertEstimate())) return;
    }
    if (option?.semanticAction === "close" || option?.systemStatus === "closed") {
      if (!(await settleInlineEdit())) return;
      await requestClose();
      return;
    }
    const result = await changeOrderStatus(value);
    if (result.ok) {
      if (result.order) onOrderUpdated(result.order);
      return;
    }
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

  return {
    ...ctx,
    mileageConfirmDialogProps: mileageConfirm.dialogProps,
    handleStatusSelect,
    detailTabs,
    showOrderColumn,
    showFeedColumn,
    deadline,
    overdue,
    description,
    assigneeErrorMessage,
    assigneeEmptyHint,
    handleAssigneeChange,
    handleTeamChange,
    showAddLinesSearch,
    showAddService,
    showAddMaterial,
    openServiceLinePriceAfterAdd,
    highlightExistingServiceLine,
    incrementExistingMaterialLine,
    hasServiceLines,
    hasMaterialLines,
    serviceLines,
    materialLines,
    fallbackService,
    canDeleteServiceLine,
    detailVatRate,
    warehouseNameById,
    purchasePriceById,
    updateServiceLinePending,
    updateMaterialLinePending,
    deleteServiceLinePending,
    deleteMaterialLinePending,
    setCatalogServiceId,
    setCatalogInventoryId,
    saveServiceLineField,
    saveMaterialLineField,
    handleDeleteServiceLine,
    handleDeleteMaterialLine,
    focusAddLinesSearch,
    filesTabActive,
    showFooter,
    showCancelAction,
    showFooterDeleteAction,
    showConvertEstimate: Boolean(cardVisibility.showConvertButton && canEditOrder),
    convertEstimatePending: convertEstimate.isPending,
    handleConvertEstimate,
    canSaveAndClose,
    lifecycleBusy,
    footerSavePending,
    deleteOrderPending: deleteOrder.isPending,
    openDeleteConfirm,
    handleCloseOrderClick,
    handleSaveAndClose,
    applyPendingMaterials,
    catalogServiceId,
    catalogInventoryId,
    editServiceLineId,
    setEditServiceLineId,
    editMaterialLineId,
    setEditMaterialLineId,
    i18nLanguage: i18n.language,
    deleteOrderMutateAsync: deleteOrder.mutateAsync,
    staticContextValue,
    editingContextValue,
  };
}
