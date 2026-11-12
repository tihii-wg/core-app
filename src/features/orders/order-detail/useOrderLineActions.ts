import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import type { Order, OrderMaterial } from "../../../lib/types";
import { isCatalogOrderMaterial } from "../../inventory/orderMaterialLine";
import { useActiveWorkspaceId } from "../../profiles/useGetProfile";
import { useGetWarehouses } from "../../warehouses/useGetWarehouses";
import { appendOrderMaterialLines, appendOrderServiceLines } from "../appendOrderLines";
import { materialDraftForUndo } from "../deleteOrderMaterialLine";
import { showOrderLineDeletedToast } from "../orderLineDeleteToast";
import type { MaterialLineInlineField } from "../OrderMaterialLineInlineCells";
import type { ServiceLineInlineField, ServiceLineInlineEditTarget } from "../OrderServiceLineInlineCells";
import { parseOrderServiceLinePrice } from "../updateOrderServiceLine";
import { useDeleteOrderMaterialLine } from "../useDeleteOrderMaterialLine";
import { useDeleteOrderServiceLine } from "../useDeleteOrderServiceLine";
import { useUpdateOrderMaterialLine } from "../useUpdateOrderMaterialLine";
import { useUpdateOrderServiceLine } from "../useUpdateOrderServiceLine";
import { withOptimisticLinePrice, withoutLine, withPendingMaterials } from "./orderLineOptimistic";
import { useStableCallback } from "./useStableCallback";
import { ORDER_FIELD_SAVED_TOAST_ID } from "../useUpdateOrderFields";

type LineActionsOptions = {
  order: Order | null;
  onOrderUpdated: (order: Order) => void;
  canEditLines: boolean;
  canWarehouse: boolean;
  setServiceLineEdit: (target: ServiceLineInlineEditTarget | null) => void;
  setMaterialLineEdit: (target: { lineId: string; field: MaterialLineInlineField } | null) => void;
  setHighlightedServiceId: (serviceId: string | null) => void;
};

/**
 * Stable line-action callbacks for the order card items tab.
 * Latest `order` is read from a ref so callbacks keep a fixed identity.
 */
export function useOrderLineActions({
  order,
  onOrderUpdated,
  canEditLines,
  canWarehouse,
  setServiceLineEdit,
  setMaterialLineEdit,
  setHighlightedServiceId,
}: LineActionsOptions) {
  const { t } = useTranslation();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: warehouses = [] } = useGetWarehouses();
  const updateServiceLine = useUpdateOrderServiceLine();
  const updateMaterialLine = useUpdateOrderMaterialLine();
  const deleteServiceLine = useDeleteOrderServiceLine();
  const deleteMaterialLine = useDeleteOrderMaterialLine();
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const orderRef = useRef(order);
  orderRef.current = order;
  const onOrderUpdatedRef = useRef(onOrderUpdated);
  onOrderUpdatedRef.current = onOrderUpdated;
  const canEditRef = useRef(canEditLines);
  canEditRef.current = canEditLines;
  const canWarehouseRef = useRef(canWarehouse);
  canWarehouseRef.current = canWarehouse;

  const focusAddLinesSearch = useCallback(() => {
    // Called when an inline line editor closes. The search field is deliberately NOT re-focused: a focused
    // search reopens its result list over the lines, so focus leaves the editor and lands nowhere.
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest('[data-testid="order-items-actions"]')) active.blur();
    });
  }, []);

  const scrollServiceLineIntoView = useCallback((serviceId: string) => {
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-order-service-line-id="${serviceId}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, []);

  /**
   * Search picked a catalog service that is already on the order: no duplicate line — bump the existing
   * line's quantity by 1 (optimistic, same path as the inline quantity editor) and flash the row.
   */
  const highlightExistingServiceLine = useStableCallback((serviceId: string) => {
    setHighlightedServiceId(serviceId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedServiceId(null), 2400);
    scrollServiceLineIntoView(serviceId);
    const existing = orderRef.current?.services.find((line) => line.serviceId === serviceId && line.id);
    if (!existing?.id) return;
    if (!canEditRef.current) {
      toast(t("orders.toast.serviceAlreadyInOrder"));
      return;
    }
    const quantity = (Number(existing.quantity) || 1) + 1;
    const message = t("orders.toast.serviceAlreadyInOrderIncreased", { quantity });
    toast.success(message, { id: ORDER_FIELD_SAVED_TOAST_ID });
    void saveServiceLineField(existing.id, "quantity", String(quantity), message).catch((error: unknown) => {
      toast.error(error instanceof Error && error.message ? error.message : t("common.somethingWentWrong"));
    });
  });

  /**
   * Search picked a catalog inventory item that is already on the order: bump the existing line's quantity
   * by 1 (issues one more unit from that line's warehouse; the RPC enforces the stock limit and the
   * optimistic update rolls back with its error). Returns false when there is no such line.
   */
  const incrementExistingMaterialLine = useStableCallback((inventoryItemId: string): boolean => {
    const selectedOrder = orderRef.current;
    if (!selectedOrder) return false;
    const existing = (selectedOrder.materials ?? []).find(
      (line) => line.id && isCatalogOrderMaterial(line) && line.inventoryItemId === inventoryItemId,
    );
    if (!existing?.id) return false;
    const lineId = existing.id;
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-order-material-line-row="${lineId}"]`);
      if (!row) return;
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const flash = ["bg-primary/10", "ring-1", "ring-inset", "ring-primary/40"];
      row.classList.add(...flash);
      setTimeout(() => row.classList.remove(...flash), 2400);
    });
    if (!canEditRef.current || !canWarehouseRef.current) {
      toast(t("orders.toast.materialAlreadyInOrder"));
      return true;
    }
    const quantity = (Number(existing.quantity) || 0) + 1;
    const message = t("orders.toast.materialAlreadyInOrderIncreased", { quantity });
    toast.success(message, { id: ORDER_FIELD_SAVED_TOAST_ID });
    void saveMaterialLineField(lineId, "quantity", String(quantity), message).catch((error: unknown) => {
      toast.error(error instanceof Error && error.message ? error.message : t("common.somethingWentWrong"));
    });
    return true;
  });

  const openServiceLinePriceAfterAdd = useStableCallback((updated: Order, catalogServiceId: string) => {
    const prevIds = new Set((orderRef.current?.services ?? []).map((line) => line.id).filter(Boolean));
    const created =
      updated.services.find((line) => line.serviceId === catalogServiceId && line.id && !prevIds.has(line.id)) ??
      updated.services.find((line) => line.serviceId === catalogServiceId && line.id);
    if (!created?.id) return;
    setHighlightedServiceId(catalogServiceId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedServiceId(null), 2400);
    scrollServiceLineIntoView(catalogServiceId);
    // No price editor here: focus stays in the search so the next service / item can be picked right away
    // (the price is edited by clicking it in the row).
  });

  const saveServiceLineField = useStableCallback(
    async (lineId: string, field: ServiceLineInlineField, raw: string, successMessage?: string) => {
      const selectedOrder = orderRef.current;
      if (!selectedOrder) return;
      if (field === "price") {
        const price = parseOrderServiceLinePrice(raw);
        if (price === "invalid") throw new Error(t("orders.form.freeformPriceInvalid"));
        const previous = selectedOrder;
        onOrderUpdatedRef.current(withOptimisticLinePrice(previous, "service", lineId, price));
        void updateServiceLine
          .mutateAsync({ orderId: previous.id, lineId, patch: { price } })
          .then((updated) => onOrderUpdatedRef.current(updated))
          .catch((error: unknown) => {
            onOrderUpdatedRef.current(previous);
            toast.error(error instanceof Error && error.message ? error.message : t("common.somethingWentWrong"));
          });
        return;
      }
      if (field === "quantity") {
        const quantity = Number(raw);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(t("orders.validation.quantityMin"));
        const line = selectedOrder.services.find((entry) => entry.id === lineId);
        const previous = selectedOrder;
        onOrderUpdatedRef.current(
          withOptimisticLinePrice(previous, "service", lineId, Number(line?.price) || 0, quantity),
        );
        void updateServiceLine
          .mutateAsync({ orderId: previous.id, lineId, patch: { quantity } })
          .then((updated) => {
            onOrderUpdatedRef.current(updated);
            // Replaces the generic «Сохранено» toast of the mutation with the caller's explanation.
            if (successMessage) toast.success(successMessage, { id: ORDER_FIELD_SAVED_TOAST_ID });
          })
          .catch((error: unknown) => {
            onOrderUpdatedRef.current(previous);
            toast.error(error instanceof Error && error.message ? error.message : t("common.somethingWentWrong"));
          });
        return;
      }
      const updated = await updateServiceLine.mutateAsync({
        orderId: selectedOrder.id,
        lineId,
        patch: { technicianId: raw.trim() ? raw.trim() : null },
      });
      onOrderUpdatedRef.current(updated);
    },
  );

  const saveMaterialLineField = useStableCallback(
    async (lineId: string, field: MaterialLineInlineField, raw: string, successMessage?: string) => {
      const selectedOrder = orderRef.current;
      if (!selectedOrder) return;
      const line = (selectedOrder.materials ?? []).find((entry) => entry.id === lineId);
      const warehouseName = line?.warehouseId
        ? warehouses.find((warehouse) => warehouse.id === line.warehouseId)?.name
        : undefined;
      if (field === "price") {
        const price = parseOrderServiceLinePrice(raw);
        if (price === "invalid") throw new Error(t("orders.errors.materialPriceInvalid"));
        const previous = selectedOrder;
        onOrderUpdatedRef.current(withOptimisticLinePrice(previous, "material", lineId, price));
        void updateMaterialLine
          .mutateAsync({ orderId: previous.id, lineId, patch: { price }, warehouseName })
          .then((updated) => onOrderUpdatedRef.current(updated))
          .catch((error: unknown) => {
            onOrderUpdatedRef.current(previous);
            toast.error(error instanceof Error && error.message ? error.message : t("common.somethingWentWrong"));
          });
        return;
      }
      const quantity = Number(raw);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(t("orders.validation.quantityMin"));
      }
      if (!line) {
        const updated = await updateMaterialLine.mutateAsync({
          orderId: selectedOrder.id,
          lineId,
          patch: { quantity },
          warehouseName,
        });
        onOrderUpdatedRef.current(updated);
        return;
      }
      const previous = selectedOrder;
      onOrderUpdatedRef.current(withOptimisticLinePrice(previous, "material", lineId, Number(line.price) || 0, quantity));
      void updateMaterialLine
        .mutateAsync({ orderId: previous.id, lineId, patch: { quantity }, warehouseName })
        .then((updated) => {
          onOrderUpdatedRef.current(updated);
          if (successMessage) toast.success(successMessage, { id: ORDER_FIELD_SAVED_TOAST_ID });
        })
        .catch((error: unknown) => {
          onOrderUpdatedRef.current(previous);
          toast.error(error instanceof Error && error.message ? error.message : t("common.somethingWentWrong"));
        });
    },
  );

  const handleDeleteServiceLine = useStableCallback(async (lineId: string) => {
    const selectedOrder = orderRef.current;
    if (!selectedOrder || !canEditRef.current) return;
    const line = selectedOrder.services.find((entry) => entry.id === lineId);
    if (!line) return;
    const snapshot = { ...line };
    const previous = selectedOrder;
    onOrderUpdatedRef.current(withoutLine(previous, "service", lineId));
    focusAddLinesSearch();
    const deletion = deleteServiceLine.mutateAsync({ orderId: previous.id, lineId });
    showOrderLineDeletedToast(async () => {
      const deleted = await deletion.then(() => true).catch(() => false);
      if (!deleted) return;
      const restored = await appendOrderServiceLines(previous.id, [snapshot], workspaceId);
      onOrderUpdatedRef.current(restored);
    });
    try {
      onOrderUpdatedRef.current(await deletion);
    } catch (error) {
      onOrderUpdatedRef.current(previous);
      toast.dismiss("order-line-deleted");
      toast.error(error instanceof Error && error.message ? error.message : t("common.somethingWentWrong"));
    }
  });

  const handleDeleteMaterialLine = useStableCallback(async (lineId: string) => {
    const selectedOrder = orderRef.current;
    if (!selectedOrder || !canEditRef.current) return;
    const line = (selectedOrder.materials ?? []).find((entry) => entry.id === lineId);
    if (!line) return;
    if (isCatalogOrderMaterial(line) && !canWarehouseRef.current) return;
    const snapshot = materialDraftForUndo(line);
    const previous = selectedOrder;
    onOrderUpdatedRef.current(withoutLine(previous, "material", lineId));
    focusAddLinesSearch();
    const deletion = deleteMaterialLine.mutateAsync({ orderId: previous.id, lineId });
    showOrderLineDeletedToast(async () => {
      const deleted = await deletion.then(() => true).catch(() => false);
      if (!deleted) return;
      const restored = await appendOrderMaterialLines(previous.id, [snapshot], workspaceId);
      onOrderUpdatedRef.current(restored);
    });
    try {
      onOrderUpdatedRef.current(await deletion);
    } catch (error) {
      onOrderUpdatedRef.current(previous);
      toast.dismiss("order-line-deleted");
      toast.error(error instanceof Error && error.message ? error.message : t("common.somethingWentWrong"));
    }
  });

  const applyPendingMaterials = useStableCallback((drafts: readonly OrderMaterial[]) => {
    const selectedOrder = orderRef.current;
    if (!selectedOrder) return () => undefined;
    const previous = selectedOrder;
    onOrderUpdatedRef.current(withPendingMaterials(previous, drafts));
    return () => onOrderUpdatedRef.current(previous);
  });

  return {
    focusAddLinesSearch,
    highlightExistingServiceLine,
    incrementExistingMaterialLine,
    openServiceLinePriceAfterAdd,
    saveServiceLineField,
    saveMaterialLineField,
    handleDeleteServiceLine,
    handleDeleteMaterialLine,
    applyPendingMaterials,
    updateServiceLinePending: updateServiceLine.isPending,
    updateMaterialLinePending: updateMaterialLine.isPending,
    deleteServiceLinePending: deleteServiceLine.isPending,
    deleteMaterialLinePending: deleteMaterialLine.isPending,
    setServiceLineEdit,
    setMaterialLineEdit,
  };
}
