import { useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
import type { Order, OrderStatus } from "../../lib/types";
import { useUpdateOrderStatus, findCachedOrder } from "./useGetOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { hasTaxInvoiceNumber, isTaxInvoiceBlocked } from "./taxInvoice";

/** Prefer a non-empty tax invoice number from either side of a merge. */
function preferTaxInvoiceNumber(primary: Order, secondary?: Order | null) {
  if (hasTaxInvoiceNumber(primary)) return primary.taxInvoiceNumber ?? "";
  if (secondary && hasTaxInvoiceNumber(secondary)) return secondary.taxInvoiceNumber ?? "";
  return primary.taxInvoiceNumber ?? secondary?.taxInvoiceNumber ?? "";
}

export function useOrderDetails() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { mutate: updateStatus, isPending: isStatusUpdating } = useUpdateOrderStatus();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const requireTaxInvoiceNumber = workspace?.requireTaxInvoiceNumber === true;
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const openOrder = (order: Order) => {
    // List rows can still be stale while placeholderData is showing a pre-save
    // page; merge any cached saved tax invoice number so the field is not empty+red.
    const cached = findCachedOrder(queryClient, workspaceId, order.id);
    const taxInvoiceNumber = preferTaxInvoiceNumber(order, cached);
    setSelectedOrder({
      ...(cached ?? order),
      ...order,
      taxInvoiceNumber,
    });
    setDetailPanelOpen(true);
  };

  const syncOrder = (order: Order) =>
    setSelectedOrder((current) => {
      if (current?.id !== order.id) return current;
      // Never let a refetch/partial payload wipe a known saved tax invoice number.
      return { ...order, taxInvoiceNumber: preferTaxInvoiceNumber(order, current) };
    });

  const applyStatusLocally = (orderId: string, newStatus: OrderStatus) => {
    setSelectedOrder((current) => {
      if (current?.id !== orderId) return current;
      // Spread keeps taxInvoiceNumber and every other field; only status/payment change.
      return {
        ...current,
        status: newStatus,
        ...(newStatus === "paid" ? { isPaid: true, paymentStatus: "paid" as const } : {}),
      };
    });
  };

  const changeStatus = (order: Order, newStatus: OrderStatus) => {
    if (order.status === newStatus || isStatusUpdating) return;
    // Resolve against cache so a stale list row without the number cannot block
    // pay after the number was already saved in this session.
    const cached = findCachedOrder(queryClient, workspaceId, order.id);
    const resolved: Order = {
      ...order,
      taxInvoiceNumber: preferTaxInvoiceNumber(order, cached),
    };
    if (isTaxInvoiceBlocked(resolved, newStatus, requireTaxInvoiceNumber)) {
      // Keep the user in the order context so the number can be entered and saved first.
      toast.error(t("orders.taxInvoice.required"), { id: "tax-invoice-required" });
      openOrder(resolved);
      return;
    }
    updateStatus(
      { orderId: order.id, status: newStatus },
      {
        onSuccess: () => applyStatusLocally(order.id, newStatus),
      },
    );
  };

  const handleStatusChange = (newStatus: OrderStatus) => {
    if (!selectedOrder) return;
    changeStatus(selectedOrder, newStatus);
  };

  return {
    openOrder,
    syncOrder,
    changeStatus,
    isStatusUpdating,
    panelProps: {
      selectedOrder,
      detailPanelOpen,
      setDetailPanelOpen,
      onOrderUpdated: setSelectedOrder,
      onStatusChange: handleStatusChange,
      isStatusUpdating,
    },
  };
}
