import { useTranslation } from "react-i18next";
import { cn } from "../../../lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../../ui/Sheet";
import EditOrderForm from "../EditOrderForm";
import { OrderPaymentStagesSection } from "../../finance/OrderPaymentStagesSection";
import { prepareOrderForCloseOrPayment } from "../requestCloseOrder";
import { useConfirm } from "../../../ui/ConfirmProvider";
import { OrderDetailFooter } from "./OrderDetailFooter";
import { OrderHistoryColumn } from "./OrderHistoryColumn";
import { OrderDetailHeader } from "./OrderDetailHeader";
import { OrderDetailTabs } from "./OrderDetailTabs";
import { OrderDetailDialogs } from "./OrderDetailDialogs";
import { OrderDetailStatusBar } from "./OrderDetailStatusBar";
import { OrderPaymentsTab } from "./tabs/OrderPaymentsTab";
import { OrderFilesTab } from "./tabs/OrderFilesTab";
import { OrderItemsTab } from "./tabs/OrderItemsTab";
import { OrderInfoTab } from "./tabs/OrderInfoTab";
import { customEditFieldKey } from "../orderFieldRegistry";
import { customInlineKind } from "./detailHelpers";
import { useStableCallback, useStableHandlers } from "./useStableCallback";
import { OrderInlineField } from "../OrderInlineField";

/** Presentational sheet for order detail — receives a precomputed view model from the panel shell. */
export function OrderDetailSheet(p: Record<string, any>) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const onStartEdit = useStableCallback(() => {
    void p.startFieldEdit(null);
  });
  const {

    detailPanelOpen, handleOpenChange, sheetContentRef, editingField, serviceLineEdit, materialLineEdit,
    changeClientOpen, selectedOrder, isEditing, canEditOrder, closedContentLocked, formatMoney, paymentBalance,
    workspaceVatRate, copy, lifecycleStatusLocked, paidStatusLocked, paidStatusBlocked,
    isStatusUpdating, isUnifiedStatusUpdating, isAssigneeUpdating, currentUnifiedStatus, statusOptions,
    handleStatusSelect, detailTab, selectDetailTab, isDesktopFeedLayout, detailTabs, showOrderColumn,
    showFeedColumn, editFormRef, setEditFormSubmitting, onOrderUpdated, setDetailPanelOpen, stopEditing,
    payments, onOpenClient, setChangeClientOpen, showClientVehicles, showFieldEdit, canChangeClientVehicle,
    taxInvoiceRequired, orderFieldMap, orderFieldConfig, customFieldValues, fieldLabel, fieldVisible,
    showAssetField, industryBlocks, deadline, overdue, description, inlineCommon, renderTextField,
    renderDateTimeField, technicianOptions, teamOptions, assigneeErrorMessage, assigneeEmptyHint,
    handleAssigneeChange, handleTeamChange, workflow, industrySlug, showAddLinesSearch, showAddService,
    showAddMaterial, addLinesSearchFocusRef, openServiceLinePriceAfterAdd, highlightExistingServiceLine,
    setAddMaterialPrefill, setAddMaterialOpen, hasServiceLines, hasMaterialLines, serviceLines, materialLines,
    fallbackService, highlightedServiceId, canDeleteServiceLine, canOpenServiceForm, canWarehouse,
    showWarrantyKm, detailVatRate, warehouseNameById, purchasePriceById, warehouseStock,
    updateServiceLinePending, updateMaterialLinePending, deleteServiceLinePending, deleteMaterialLinePending,
    setCatalogServiceId, setCatalogInventoryId, setServiceLineEdit, setMaterialLineEdit, saveServiceLineField,
    saveMaterialLineField, handleDeleteServiceLine, handleDeleteMaterialLine, focusAddLinesSearch,
    paymentsLoading, filesTabActive, showFooter, showCancelAction, showFooterDeleteAction,
    showOpenLifecycleActions, canSaveAndClose, lifecycleBusy, footerSavePending, deleteBlockedReason,
    deleteOrderPending, setCancelOpen, openDeleteConfirm, handleCloseOrderClick, handleSaveAndClose,
    closeSheet, confirmDeleteOpen, setConfirmDeleteOpen, linkedPaymentCount, onDeleted, hasInvoice,
    closeOpen, setCloseOpen, cancelOpen, recordPaymentOpen, setRecordPaymentOpen, addMaterialOpen,
    addMaterialPrefill, applyPendingMaterials, catalogServiceId, catalogInventoryId, i18nLanguage,
    editFocusField, deleteOrderMutateAsync, editServiceLineId, setEditServiceLineId,
    editMaterialLineId, setEditMaterialLineId, mileageConfirmDialogProps, linkedVehicle,
  } = p;

  // Stable event handlers: memoized children (header, tabs, line tables/rows, footer) only re-render when
  // their data changes, not because a new arrow function was created on this render.
  const h = useStableHandlers({
    statusSelect: (value: string) => {
      void handleStatusSelect(value);
    },
    selectTab: (tab: Parameters<typeof selectDetailTab>[0]) => void selectDetailTab(tab),
    orderUpdated: (order: Parameters<typeof onOrderUpdated>[0]) => onOrderUpdated(order),
    openClient: (clientId: string) => onOpenClient?.(clientId),
    changeClientRequest: () => setChangeClientOpen(true),
    assigneeChange: (id: string) => void handleAssigneeChange(id),
    teamChange: (team: Parameters<typeof handleTeamChange>[0]) => void handleTeamChange(team),
    serviceAdded: (updated: Parameters<typeof onOrderUpdated>[0], meta?: { catalogServiceId?: string }) => {
      onOrderUpdated(updated);
      if (meta?.catalogServiceId) openServiceLinePriceAfterAdd(updated, meta.catalogServiceId);
    },
    highlightServiceLine: (serviceId: string) => highlightExistingServiceLine(serviceId),
    openMaterial: (prefill: Parameters<typeof setAddMaterialPrefill>[0]) => {
      setAddMaterialPrefill(prefill);
      setAddMaterialOpen(true);
    },
    openServiceCatalog: (id: string) => setCatalogServiceId(id),
    openMaterialCatalog: (id: string) => setCatalogInventoryId(id),
    requestServiceEdit: (lineId: string, field: string) => setServiceLineEdit({ lineId, field }),
    requestMaterialEdit: (lineId: string, field: string) => setMaterialLineEdit({ lineId, field }),
    clearServiceEdit: () => setServiceLineEdit(null),
    clearMaterialEdit: () => setMaterialLineEdit(null),
    saveServiceField: (lineId: string, field: string, raw: string) => saveServiceLineField(lineId, field, raw),
    saveMaterialField: (lineId: string, field: string, raw: string) => saveMaterialLineField(lineId, field, raw),
    deleteService: (lineId: string) => void handleDeleteServiceLine(lineId),
    deleteMaterial: (lineId: string) => void handleDeleteMaterialLine(lineId),
    editServiceLine: (lineId: string) => setEditServiceLineId(lineId),
    editMaterialLine: (lineId: string) => setEditMaterialLineId(lineId),
    editorClosed: () => focusAddLinesSearch(),
    beforeRecord: async () => {
      const prepared = await prepareOrderForCloseOrPayment({ order: selectedOrder, confirm, t });
      if (!prepared) return false;
      if (prepared !== selectedOrder) {
        onOrderUpdated(prepared);
        stopEditing();
      }
      return true;
    },
    footerCancel: () => setCancelOpen(true),
    footerDelete: () => openDeleteConfirm(),
    footerCloseOrder: () => void handleCloseOrderClick(),
    footerSaveAndClose: () => void handleSaveAndClose(),
    footerCloseWindow: () => closeSheet(),
  });

  return (

    <Sheet open={detailPanelOpen} onOpenChange={handleOpenChange}>
      <SheetContent
        ref={sheetContentRef}
        className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-lg lg:max-w-[min(1100px,calc(100vw-2rem))]"
        onEscapeKeyDown={(event) => {
          // Esc while a field / service line / change-client dialog is active must not close the sheet.
          if (
            editingField ||
            serviceLineEdit ||
            materialLineEdit ||
            changeClientOpen ||
            editServiceLineId ||
            editMaterialLineId
          ) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          // Toasts (e.g. «Deleted · Undo») live outside the sheet; clicking them must not close the order.
          const target = event.target as HTMLElement | null;
          if (target?.closest?.('[role="status"], [data-rht-toaster], [data-testid="order-line-deleted-toast"]')) {
            event.preventDefault();
          }
        }}
      >
        {selectedOrder ? (
          <OrderDetailHeader
            selectedOrder={selectedOrder}
            isEditing={isEditing}
            canEditOrder={canEditOrder}
            closedContentLocked={closedContentLocked}
            formatMoney={formatMoney}
            paymentStatus={paymentBalance?.status ?? selectedOrder.paymentStatus}
            workspaceVatRate={workspaceVatRate}
            worksLabel={t("orders.totalBreakdown.works")}
            materialsLabel={t("orders.detail.materials")}
            detailSrDescription={copy.detailSrDescription}
            onStartEdit={onStartEdit}
          />
        ) : (
          <SheetHeader
            className="shrink-0 space-y-2 pr-14 sm:pr-24 [&_[data-slot=sheet-close]]:size-11 sm:[&_[data-slot=sheet-close]]:size-8"
          >
            <SheetTitle />
            <SheetDescription className="sr-only">{copy.detailSrDescription}</SheetDescription>
          </SheetHeader>
        )}

        {selectedOrder && !isEditing ? (
          <>
            <OrderDetailStatusBar
              selectedOrder={selectedOrder}
              lifecycleStatusLocked={lifecycleStatusLocked}
              paidStatusLocked={paidStatusLocked}
              paidStatusBlocked={paidStatusBlocked}
              canEditOrder={canEditOrder}
              isStatusUpdating={isStatusUpdating}
              isUnifiedStatusUpdating={isUnifiedStatusUpdating}
              isAssigneeUpdating={isAssigneeUpdating}
              currentUnifiedStatusId={currentUnifiedStatus?.id}
              statusOptions={statusOptions}
              paymentRemaining={paymentBalance ? paymentBalance.remaining : null}
              formatMoney={formatMoney}
              onStatusSelect={h.statusSelect}
            />

            <OrderDetailTabs
              detailTab={detailTab}
              onSelectTab={h.selectTab}
              isDesktopFeedLayout={isDesktopFeedLayout}
              tabs={detailTabs}
            />
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
              <OrderInfoTab
                order={selectedOrder}
                workflow={workflow}
                copy={copy}
                showClientVehicles={showClientVehicles}
                showFieldEdit={showFieldEdit}
                canChangeClientVehicle={canChangeClientVehicle}
                canEditOrder={canEditOrder}
                closedContentLocked={closedContentLocked}
                taxInvoiceRequired={taxInvoiceRequired}
                onOrderUpdated={h.orderUpdated}
                onOpenClient={onOpenClient ? h.openClient : undefined}
                onChangeClientRequest={h.changeClientRequest}
                orderFieldMap={orderFieldMap}
                orderFieldConfig={orderFieldConfig}
                customFieldValues={customFieldValues}
                fieldLabel={fieldLabel}
                fieldVisible={fieldVisible}
                showAssetField={showAssetField}
                industryBlocks={industryBlocks}
                deadline={deadline}
                overdue={overdue}
                description={description}
                editingField={editingField}
                inlineCommon={inlineCommon}
                renderTextField={renderTextField}
                renderDateTimeField={renderDateTimeField}
                technicianOptions={technicianOptions}
                teamOptions={teamOptions}
                isAssigneeUpdating={isAssigneeUpdating}
                isStatusUpdating={isStatusUpdating}
                assigneeErrorMessage={assigneeErrorMessage}
                assigneeEmptyHint={assigneeEmptyHint}
                onAssigneeChange={h.assigneeChange}
                onTeamChange={h.teamChange}
                customInlineKind={customInlineKind}
                customEditFieldKey={customEditFieldKey}
                linkedVehicle={linkedVehicle}
              />
            ) : null}

            {detailTab === "items" ? (
              <OrderItemsTab
                order={selectedOrder}
                descriptionSlot={
                  description || (showFieldEdit && fieldVisible("description")) ? (
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
                  ) : null
                }
                industrySlug={industrySlug ?? ""}
                showAddLinesSearch={showAddLinesSearch}
                showAddService={showAddService}
                showAddMaterial={showAddMaterial}
                addLinesSearchFocusRef={addLinesSearchFocusRef}
                onServiceAdded={h.serviceAdded}
                onHighlightServiceLine={h.highlightServiceLine}
                onOpenMaterial={h.openMaterial}
                hasServiceLines={hasServiceLines}
                hasMaterialLines={hasMaterialLines}
                serviceLines={serviceLines}
                materialLines={materialLines}
                fallbackService={fallbackService}
                highlightedServiceId={highlightedServiceId}
                serviceLineEditLineId={serviceLineEdit?.lineId ?? null}
                serviceLineEditField={serviceLineEdit?.field ?? null}
                materialLineEditLineId={materialLineEdit?.lineId ?? null}
                materialLineEditField={materialLineEdit?.field ?? null}
                showFieldEdit={showFieldEdit}
                canDeleteServiceLine={canDeleteServiceLine}
                canOpenServiceForm={canOpenServiceForm}
                canWarehouse={canWarehouse}
                closedContentLocked={closedContentLocked}
                showWarrantyKm={showWarrantyKm}
                formatMoney={formatMoney}
                locale={i18nLanguage}
                detailVatRate={detailVatRate}
                performerOptions={teamOptions}
                materialSourceCustomer={copy.materialSourceCustomer}
                warehouseNameById={warehouseNameById}
                purchasePriceById={purchasePriceById}
                warehouseStock={warehouseStock}
                updateServicePending={updateServiceLinePending}
                updateMaterialPending={updateMaterialLinePending}
                deleteServicePending={deleteServiceLinePending}
                deleteMaterialPending={deleteMaterialLinePending}
                onOpenServiceCatalog={h.openServiceCatalog}
                onOpenMaterialCatalog={h.openMaterialCatalog}
                onRequestServiceEdit={h.requestServiceEdit}
                onRequestMaterialEdit={h.requestMaterialEdit}
                onCancelServiceEdit={h.clearServiceEdit}
                onCancelMaterialEdit={h.clearMaterialEdit}
                onSavedServiceEdit={h.clearServiceEdit}
                onSavedMaterialEdit={h.clearMaterialEdit}
                onSaveServiceField={h.saveServiceField}
                onSaveMaterialField={h.saveMaterialField}
                onDeleteService={h.deleteService}
                onDeleteMaterial={h.deleteMaterial}
                onEditServiceLine={h.editServiceLine}
                onEditMaterialLine={h.editMaterialLine}
                onEditorClosed={h.editorClosed}
                onOrderUpdated={h.orderUpdated}
              />
            ) : null}

            {detailTab === "payments" ? (
              <OrderPaymentsTab
                order={selectedOrder}
                payments={payments}
                paymentsLoading={paymentsLoading}
                canEdit={canEditOrder && !closedContentLocked}
                onOrderUpdated={h.orderUpdated}
                onBeforeRecord={h.beforeRecord}
              />
            ) : null}

            {detailTab === "files" ? (
              <OrderFilesTab
                orderId={selectedOrder.id}
                enabled={filesTabActive}
                closedContentLocked={closedContentLocked}
              />
            ) : null}

                            </div>
              )}
              </div>

              {showFooter ? (
                <OrderDetailFooter
                  isDesktopFeedLayout={isDesktopFeedLayout}
                  isEditing={isEditing}
                  showCancelAction={showCancelAction}
                  showFooterDeleteAction={showFooterDeleteAction}
                  showOpenLifecycleActions={showOpenLifecycleActions}
                  canSaveAndClose={canSaveAndClose}
                  lifecycleBusy={lifecycleBusy}
                  footerSavePending={footerSavePending}
                  deleteBlockedReason={deleteBlockedReason}
                  deletePending={deleteOrderPending}
                  onCancel={h.footerCancel}
                  onDelete={h.footerDelete}
                  onCloseOrder={h.footerCloseOrder}
                  onSaveAndClose={h.footerSaveAndClose}
                  onCloseWindow={h.footerCloseWindow}
                />
              ) : null}
            </div>

            {selectedOrder ? (
              <OrderHistoryColumn
                orderId={selectedOrder.id}
                orderNumber={selectedOrder.orderNumber}
                enabled={detailPanelOpen}
                canComment={canEditOrder && !closedContentLocked}
                isDesktopFeedLayout={isDesktopFeedLayout}
                showFeedColumn={showFeedColumn}
              />
            ) : null}
          </div>
        ) : null}
      </SheetContent>

      <OrderDetailDialogs
        selectedOrder={selectedOrder}
        confirmDeleteOpen={confirmDeleteOpen}
        setConfirmDeleteOpen={setConfirmDeleteOpen}
        deletePending={deleteOrderPending}
        deleteBlockedReason={deleteBlockedReason}
        linkedPaymentCount={linkedPaymentCount}
        onConfirmDelete={() => {
          if (!selectedOrder || deleteBlockedReason || deleteOrderPending) return;
          void deleteOrderMutateAsync(selectedOrder.id).then(() => {
            setConfirmDeleteOpen(false);
            onDeleted?.(selectedOrder.id);
          });
        }}
        changeClientOpen={changeClientOpen}
        setChangeClientOpen={setChangeClientOpen}
        hasInvoice={hasInvoice}
        sheetContentRef={sheetContentRef}
        onOrderUpdated={onOrderUpdated}
        closeOpen={closeOpen}
        setCloseOpen={setCloseOpen}
        payments={payments}
        formatMoney={formatMoney}
        canRecordPayment={canEditOrder && !closedContentLocked}
        cancelOpen={cancelOpen}
        setCancelOpen={setCancelOpen}
        onDeleted={onDeleted}
        recordPaymentOpen={recordPaymentOpen}
        setRecordPaymentOpen={setRecordPaymentOpen}
        addMaterialOpen={addMaterialOpen}
        setAddMaterialOpen={setAddMaterialOpen}
        addMaterialPrefill={addMaterialPrefill}
        setAddMaterialPrefill={setAddMaterialPrefill}
        showAddMaterial={showAddMaterial}
        onPendingMaterials={applyPendingMaterials}
        catalogServiceId={catalogServiceId}
        catalogInventoryId={catalogInventoryId}
        onCloseService={() => setCatalogServiceId(null)}
        onCloseInventory={() => setCatalogInventoryId(null)}
        editServiceLineId={editServiceLineId}
        setEditServiceLineId={setEditServiceLineId}
        editMaterialLineId={editMaterialLineId}
        setEditMaterialLineId={setEditMaterialLineId}
        mileageConfirmDialogProps={mileageConfirmDialogProps}
      />
    </Sheet>
  
  );
}
