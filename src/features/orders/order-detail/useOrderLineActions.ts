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

  const highlightExistingServiceLine = useStableCallback((serviceId: string) => {
    setHighlightedServiceId(serviceId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedServiceId(null), 2400);
    scrollServiceLineIntoView(serviceId);
    const existing = orderRef.current?.services.find((line) => line.serviceId === serviceId && line.id);
    if (existing?.id) {
      setServiceLineEdit({ lineId: existing.id, field: "price" });
    }
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
    setServiceLineEdit({ lineId: created.id, field: "price" });
  });

  const saveServiceLineField = useStableCallback(async (lineId: string, field: ServiceLineInlineField, raw: string) => {
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
    const updated = await updateServiceLine.mutateAsync({
      orderId: selectedOrder.id,
      lineId,
      patch: { technicianId: raw.trim() ? raw.trim() : null },
    });
    onOrderUpdatedRef.current(updated);
  });

  const saveMaterialLineField = useStableCallback(async (lineId: string, field: MaterialLineInlineField, raw: string) => {
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
      .then((updated) => onOrderUpdatedRef.current(updated))
      .catch((error: unknown) => {
        onOrderUpdatedRef.current(previous);
        toast.error(error instanceof Error && error.message ? error.message : t("common.somethingWentWrong"));
      });
  });

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
