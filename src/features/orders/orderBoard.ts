import type { Order, OrderStatus } from "../../lib/types";
import type { StatusDefinition } from "../../services/apiStatusDefinitions";
import { ORDER_STATUSES } from "../industries/industryWorkflow";

/** Board/list switch for the Orders page (docs §5.1 "Переключатель видов запоминается"). */
export const ORDER_VIEW_MODES = ["table", "board", "calendar"] as const;
export type OrderViewMode = (typeof ORDER_VIEW_MODES)[number];
export const ORDER_VIEW_MODE_STORAGE_KEY = "coreapp.orders.viewMode";

export function readOrderViewMode(): OrderViewMode {
  try {
    const raw = window.localStorage.getItem(ORDER_VIEW_MODE_STORAGE_KEY);
    return (ORDER_VIEW_MODES as readonly string[]).includes(raw ?? "") ? (raw as OrderViewMode) : "table";
  } catch {
    return "table";
  }
}

export function writeOrderViewMode(mode: OrderViewMode) {
  try {
    window.localStorage.setItem(ORDER_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage may be unavailable (private mode, test stubs).
  }
}

/** `status_definitions.status_group` values, in board order. */
export const STATUS_GROUPS = [
  "new",
  "in_progress",
  "pending",
  "delivery",
  "done",
  "paid",
  "closed",
  "dropped_off",
  "canceled",
] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

export function isStatusGroup(value: unknown): value is StatusGroup {
  return typeof value === "string" && (STATUS_GROUPS as readonly string[]).includes(value);
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export type OrderBoardColumn = {
  /** Stable key: definition id, `system:<status>`, or `unassigned`. */
  key: string;
  kind: "custom" | "system" | "unassigned";
  definition: StatusDefinition | null;
  /** System status written when an order is dropped here (null = keep the current one). */
  systemStatus: OrderStatus | null;
  group: StatusGroup | null;
  orders: Order[];
};

function groupRank(group: string) {
  const index = (STATUS_GROUPS as readonly string[]).indexOf(group);
  return index === -1 ? STATUS_GROUPS.length : index;
}

/** Active, non-deleted order definitions sorted by group, then sort_order, then name. */
export function activeOrderDefinitions(definitions: readonly StatusDefinition[]) {
  return definitions
    .filter((definition) => definition.entity === "order" && definition.isActive)
    .sort(
      (a, b) =>
        groupRank(a.statusGroup) - groupRank(b.statusGroup) ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Builds board columns.
 * - With custom definitions: one column per definition. An order without
 *   `customStatusId` lands in the default (else first) definition whose
 *   `system_status` matches its system status; if none matches it goes to an
 *   "unassigned" column that only exists when non-empty.
 * - Without definitions: the six system OrderStatus columns.
 */
export function buildOrderBoardColumns(orders: readonly Order[], definitions: readonly StatusDefinition[]): OrderBoardColumn[] {
  const active = activeOrderDefinitions(definitions);

  if (active.length === 0) {
    return ORDER_STATUSES.map((status) => ({
      key: `system:${status}`,
      kind: "system" as const,
      definition: null,
      systemStatus: status,
      group: null,
      orders: orders.filter((order) => order.status === status),
    }));
  }

  const columns = new Map<string, OrderBoardColumn>(
    active.map((definition) => [
      definition.id,
      {
        key: definition.id,
        kind: "custom" as const,
        definition,
        systemStatus: isOrderStatus(definition.systemStatus) ? definition.systemStatus : null,
        group: isStatusGroup(definition.statusGroup) ? definition.statusGroup : null,
        orders: [],
      },
    ]),
  );

  const fallbackBySystemStatus = new Map<OrderStatus, StatusDefinition>();
  for (const definition of active) {
    if (!isOrderStatus(definition.systemStatus)) continue;
    const current = fallbackBySystemStatus.get(definition.systemStatus);
    if (!current || (definition.isDefault && !current.isDefault)) {
      fallbackBySystemStatus.set(definition.systemStatus, definition);
    }
  }

  const unassigned: OrderBoardColumn = {
    key: "unassigned",
    kind: "unassigned",
    definition: null,
    systemStatus: null,
    group: null,
    orders: [],
  };

  for (const order of orders) {
    // Formal cancelled/closed always follow system status so a stale custom_status_id
    // cannot leave the card in an ordinary workflow column after cancel/close.
    if (order.status === "cancelled" || order.status === "closed") {
      const lifecycle = fallbackBySystemStatus.get(order.status);
      const target = (lifecycle ? columns.get(lifecycle.id) : undefined) ?? unassigned;
      target.orders.push(order);
      continue;
    }
    const explicit = order.customStatusId ? columns.get(order.customStatusId) : undefined;
    const fallback = fallbackBySystemStatus.get(order.status);
    const target = explicit ?? (fallback ? columns.get(fallback.id) : undefined) ?? unassigned;
    target.orders.push(order);
  }

  return [...(unassigned.orders.length > 0 ? [unassigned] : []), ...columns.values()];
}

export type BoardMove = { status: OrderStatus; customStatusId: string | null };

/** Column an order currently sits in (same rule as buildOrderBoardColumns). */
export function boardColumnKeyForOrder(order: Order, columns: readonly OrderBoardColumn[]) {
  return columns.find((column) => column.orders.some((item) => item.id === order.id))?.key ?? null;
}

/**
 * What dropping `order` on `column` should write, or null when the drop is not
 * allowed / a no-op. Choosing a custom status sets `orders.status` to its
 * `system_status` (docs «Статусы заказов»).
 */
export function resolveBoardMove(order: Order, column: OrderBoardColumn): BoardMove | null {
  if (column.kind === "unassigned") return null;
  if (column.kind === "system") {
    if (!column.systemStatus) return null;
    if (column.systemStatus === "closed" || column.systemStatus === "cancelled") return null;
    if (order.status === column.systemStatus && !order.customStatusId) return null;
    return { status: column.systemStatus, customStatusId: null };
  }
  const definition = column.definition;
  if (!definition) return null;
  // Close/cancel columns are not ordinary drag targets — use explicit lifecycle actions.
  if (definition.semanticAction === "close" || definition.semanticAction === "cancel") return null;
  const status = column.systemStatus ?? order.status;
  if (status === "closed" || status === "cancelled") return null;
  if (order.customStatusId === definition.id && order.status === status) return null;
  return { status, customStatusId: definition.id };
}
