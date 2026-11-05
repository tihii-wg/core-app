import type { Order, OrderStatus } from "../../lib/types";
import {
  isLifecycleOrderStatusDefinition,
  pickCustomStatusForSystemStatus,
  type StatusDefinition,
} from "../../services/apiStatusDefinitions";
import { ORDER_STATUSES } from "../industries/industryWorkflow";
import { activeOrderDefinitions, isOrderStatus, type BoardMove } from "./orderBoard";

export type UnifiedStatusOption =
  | {
      kind: "definition";
      id: string;
      name: string;
      color: string | null;
      systemStatus: OrderStatus | null;
      semanticAction: StatusDefinition["semanticAction"];
      definition: StatusDefinition;
    }
  | {
      kind: "system";
      id: string;
      name: string;
      color: string | null;
      systemStatus: OrderStatus;
      semanticAction: "normal";
      definition: null;
    };

/** Active order definitions a user may pick as an ordinary status (not close/cancel). */
export function selectableOrderStatusDefinitions(definitions: readonly StatusDefinition[]) {
  return activeOrderDefinitions(definitions).filter((definition) => !isLifecycleOrderStatusDefinition(definition));
}

/** True when the order is in a formal lifecycle state (closed and/or cancelled). */
export function isLifecycleOrderStatus(order: Pick<Order, "status" | "closedAt">) {
  return Boolean(order.closedAt?.trim()) || order.status === "closed" || order.status === "cancelled";
}

/**
 * Unified status options for selectors/menus/filters.
 * Prefer workspace definitions when any exist; otherwise fall back to system OrderStatus values
 * (excluding protected closed/cancelled lifecycle actions).
 */
export function unifiedStatusOptions(
  definitions: readonly StatusDefinition[],
  systemLabel: (status: OrderStatus) => string,
): UnifiedStatusOption[] {
  const selectable = selectableOrderStatusDefinitions(definitions);
  if (selectable.length > 0) {
    return selectable.map((definition) => ({
      kind: "definition" as const,
      id: definition.id,
      name: definition.name,
      color: definition.color,
      systemStatus: isOrderStatus(definition.systemStatus) ? definition.systemStatus : null,
      semanticAction: definition.semanticAction,
      definition,
    }));
  }

  return ORDER_STATUSES.filter((status) => status !== "closed" && status !== "cancelled").map((status) => ({
    kind: "system" as const,
    id: `system:${status}`,
    name: systemLabel(status),
    color: null,
    systemStatus: status,
    semanticAction: "normal" as const,
    definition: null,
  }));
}

/**
 * Filter options include every active order status (including close/cancel definitions)
 * so Closed/Cancelled columns remain filterable without treating them as ordinary selectors.
 */
export function unifiedStatusFilterOptions(
  definitions: readonly StatusDefinition[],
  systemLabel: (status: OrderStatus) => string,
): UnifiedStatusOption[] {
  const active = activeOrderDefinitions(definitions);
  if (active.length > 0) {
    return active.map((definition) => ({
      kind: "definition" as const,
      id: definition.id,
      name: definition.name,
      color: definition.color,
      systemStatus: isOrderStatus(definition.systemStatus) ? definition.systemStatus : null,
      semanticAction: definition.semanticAction,
      definition,
    }));
  }
  return ORDER_STATUSES.map((status) => ({
    kind: "system" as const,
    id: `system:${status}`,
    name: systemLabel(status),
    color: null,
    systemStatus: status,
    semanticAction: "normal" as const,
    definition: null,
  }));
}

/**
 * Resolves which unified option currently represents the order.
 * Prefers `customStatusId`; otherwise the matching definition for `order.status`;
 * otherwise the system fallback option.
 */
export function resolveCurrentUnifiedStatus(
  order: Pick<Order, "status" | "customStatusId" | "closedAt">,
  options: readonly UnifiedStatusOption[],
): UnifiedStatusOption | null {
  if (options.length === 0) return null;
  // Closed/cancelled system status is authoritative — never let a stale regular custom_status_id win.
  // When closed_at remains set but status was changed (owner manage-closed), prefer the live status.
  if (order.status === "cancelled" || order.status === "closed") {
    const lifecycleStatus: OrderStatus = order.status === "cancelled" ? "cancelled" : "closed";
    return options.find((option) => option.systemStatus === lifecycleStatus) ?? null;
  }
  if (options[0]?.kind === "definition") {
    if (order.customStatusId) {
      const explicit = options.find((option) => option.id === order.customStatusId);
      if (explicit) return explicit;
    }
    const definitions = options
      .filter((option): option is Extract<UnifiedStatusOption, { kind: "definition" }> => option.kind === "definition")
      .map((option) => option.definition);
    const matched = pickCustomStatusForSystemStatus(definitions, order.status);
    if (matched) {
      return options.find((option) => option.id === matched.id) ?? null;
    }
    return null;
  }
  return options.find((option) => option.systemStatus === order.status) ?? null;
}

/** What selecting `option` should persist, or null when no-op / forbidden. */
export function resolveUnifiedStatusSelection(
  order: Pick<Order, "status" | "customStatusId" | "closedAt">,
  option: UnifiedStatusOption,
  opts?: { allowManageClosed?: boolean },
): BoardMove | null {
  if (option.semanticAction === "close" || option.semanticAction === "cancel") return null;
  if (option.systemStatus === "closed" || option.systemStatus === "cancelled") return null;

  // Closed/cancelled are lifecycle-only unless the owner manage-closed override is active.
  // Cancelled-without-close stays locked (no reopen via ordinary selector).
  if (isLifecycleOrderStatus(order)) {
    if (!opts?.allowManageClosed) return null;
    if (order.status === "cancelled" && !order.closedAt?.trim()) return null;
  }

  if (option.kind === "definition") {
    const status = option.systemStatus ?? (isOrderStatus(order.status) ? order.status : null);
    if (!status || status === "closed" || status === "cancelled") return null;
    if (order.customStatusId === option.id && order.status === status) return null;
    return { status, customStatusId: option.id };
  }

  if (order.status === option.systemStatus && !order.customStatusId) return null;
  return { status: option.systemStatus, customStatusId: null };
}

/** True when workspace has configurable order statuses (definitions drive the UI). */
export function hasConfigurableOrderStatuses(definitions: readonly StatusDefinition[]) {
  return selectableOrderStatusDefinitions(definitions).length > 0;
}
