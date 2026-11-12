import { preserveOrderLineComments } from "./applyOrderLineMutationCache";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
import type { Order, OrderStatus } from "../../lib/types";
import type { UpdateOrderStatusResult } from "../../services/apiOrders";
import { useUpdateOrderStatus, findCachedOrder } from "./useGetOrders";
import { useActiveWorkspaceId } from "../profiles/useGetProfile";
import { useGetWorkspace } from "../workspaces/useGetWorkspace";
import { useActiveWorkspaceRole } from "../workspaces/useActiveWorkspaceRole";
import { canManageWorkspace } from "../workspaces/workspaceRoles";
import {
  hasTaxInvoiceNumber,
  isPaidStatusChangeForbidden,
  isTaxInvoiceBlocked,
  resolveClientTypeForTaxGate,
} from "./taxInvoice";

/** Prefer a non-empty tax invoice number from either side of a merge. */
function preferTaxInvoiceNumber(primary: Order, secondary?: Order | null) {
  if (hasTaxInvoiceNumber(primary)) return primary.taxInvoiceNumber ?? "";
  if (secondary && hasTaxInvoiceNumber(secondary)) return secondary.taxInvoiceNumber ?? "";
  return primary.taxInvoiceNumber ?? secondary?.taxInvoiceNumber ?? "";
}

/** Merge list/cache snapshots for the UI paid gate without inventing a number. */
function resolveOrderForTaxGate(order: Order, cached?: Order | null): Order {
  return {
    ...order,
    clientType: resolveClientTypeForTaxGate(order, cached),
    taxInvoiceNumber: preferTaxInvoiceNumber(order, cached),
  };
}

export function useOrderDetails() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { mutate: updateStatus, isPending: isStatusUpdating } = useUpdateOrderStatus();
  const { workspaceId } = useActiveWorkspaceId();
  const { data: workspace } = useGetWorkspace(workspaceId);
  const requireTaxInvoiceNumber = workspace?.requireTaxInvoiceNumber === true;
  // UI gate only — API re-checks workspaces.owner_id. Role "owner" is the membership
  // mirror of ownership; admin/manager do not unlock Paid.
  const isWorkspaceOwner = canManageWorkspace(useActiveWorkspaceRole());
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const openOrder = (order: Order) => {
    // List rows can still be stale while placeholderData is showing a pre-save
    // page; merge any cached saved tax invoice number so the field is not empty+red.
    const cached = findCachedOrder(queryClient, workspaceId, order.id);
    setSelectedOrder(resolveOrderForTaxGate(order, cached));
    setDetailPanelOpen(true);
  };

  const syncOrder = (order: Order) =>
    setSelectedOrder((current) => {
      if (current?.id !== order.id) return current;
      // Never let a refetch/partial payload wipe a known saved tax invoice number (nor line comments,
      // which line RPC payloads do not carry).
      return resolveOrderForTaxGate(preserveOrderLineComments(current, order), current);
    });

  // Card updates (line RPC results) keep the line comments already shown.
  const updateSelectedOrder = (order: Order) =>
    setSelectedOrder((current) => (current?.id === order.id ? preserveOrderLineComments(current, order) : order));

  const clearOrder = (orderId: string) => {
    setSelectedOrder((current) => {
      if (current?.id !== orderId) return current;
      return null;
    });
    setDetailPanelOpen(false);
  };

  const applyStatusLocally = (orderId: string, result: UpdateOrderStatusResult) => {
    setSelectedOrder((current) => {
      if (current?.id !== orderId) return current;
      // Spread keeps taxInvoiceNumber and every other field; sync system + custom status together.
      const leftPaid = current.status === "paid" && result.status !== "paid";
      return {
        ...current,
        status: result.status,
        customStatusId: result.customStatusId,
        customStatus: result.customStatus,
        ...(Object.prototype.hasOwnProperty.call(result, "closedAt") ? { closedAt: result.closedAt ?? null } : {}),
        ...(result.status === "paid"
          ? { isPaid: true, paymentStatus: "paid" as const }
          : leftPaid
            ? { isPaid: false, paymentStatus: "unpaid" as const }
            : {}),
      };
    });
  };

  /**
   * UI gate for every order status control (table menu, mobile card menu,
   * detail panel). The API `updateOrderStatus` re-checks persisted ownership and
   * Paid state; this gate only avoids a round-trip and opens the tax-invoice field early.
   */
  const changeStatus = (order: Order, newStatus: OrderStatus) => {
    if (order.status === newStatus || isStatusUpdating) return;
    const cached = findCachedOrder(queryClient, workspaceId, order.id);
    // Fail closed on Paid using either the row or a fresher cached snapshot.
    const currentStatus = cached?.status === "paid" || order.status === "paid" ? "paid" : order.status;
    if (isPaidStatusChangeForbidden(currentStatus, newStatus, isWorkspaceOwner)) {
      toast.error(t("orders.errors.paidStatusLocked"), { id: "paid-status-locked" });
      return;
    }
    const resolved = resolveOrderForTaxGate(order, cached);
    if (isTaxInvoiceBlocked(resolved, newStatus, requireTaxInvoiceNumber)) {
      toast.error(t("orders.taxInvoice.required"), { id: "tax-invoice-required" });
      openOrder(resolved);
      return;
    }
    updateStatus(
      { orderId: order.id, status: newStatus },
      {
        onSuccess: (result) => applyStatusLocally(order.id, result),
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
    clearOrder,
    changeStatus,
    isStatusUpdating,
    requireTaxInvoiceNumber,
    isWorkspaceOwner,
    panelProps: {
      selectedOrder,
      detailPanelOpen,
      setDetailPanelOpen,
      onOrderUpdated: updateSelectedOrder,
      onStatusChange: handleStatusChange,
      isStatusUpdating,
    },
  };
}
