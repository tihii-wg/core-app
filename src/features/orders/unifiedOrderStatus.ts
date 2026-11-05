import type { Order, OrderStatus } from "../../lib/types";
import type { StatusDefinition } from "../../services/apiStatusDefinitions";
import { ORDER_STATUSES } from "../industries/industryWorkflow";
import { activeOrderDefinitions, isOrderStatus, type BoardMove } from "./orderBoard";
import { pickCustomStatusForSystemStatus } from "../../services/apiStatusDefinitions";

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
  return activeOrderDefinitions(definitions).filter(
    (definition) =>
      definition.semanticAction === "normal" &&
      definition.systemStatus !== "closed" &&
      definition.systemStatus !== "cancelled",
  );
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
  // Lifecycle orders may still carry a normal custom_status_id (owner annotation).
  if (isLifecycleOrderStatus(order) && options[0]?.kind === "definition" && order.customStatusId) {
    const annotated = options.find((option) => option.id === order.customStatusId);
    if (annotated) return annotated;
  }
  if (order.status === "cancelled" || order.status === "closed") {
    return options.find((option) => option.systemStatus === order.status) ?? null;
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
): BoardMove | null {
  if (option.semanticAction === "close" || option.semanticAction === "cancel") return null;
  if (option.systemStatus === "closed" || option.systemStatus === "cancelled") return null;

  // Closed/cancelled: keep lifecycle `status`; only a normal custom definition may change.
  if (isLifecycleOrderStatus(order)) {
    if (option.kind !== "definition" || option.semanticAction !== "normal") return null;
    if (order.customStatusId === option.id) return null;
    const lifecycleStatus: OrderStatus =
      order.status === "cancelled" ? "cancelled" : order.status === "closed" ? "closed" : "closed";
    return { status: lifecycleStatus, customStatusId: option.id };
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
