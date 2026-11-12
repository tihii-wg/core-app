import { appendOrderCatalogServiceLine, getOrder, updateOrder } from "../../services/apiOrders";
import type { Order, OrderMaterial, OrderService, UpdateOrderDetails } from "../../lib/types";

/**
 * `updateOrder` always rewrites the order row (device, description, assignee, deadline, ...) and the team, so a
 * lines-only append / single-line patch must echo the freshly loaded values back — same shape the panel's
 * assignee / team handlers send. Industry fields and mileage snapshots are omitted on purpose: omitted means
 * "leave the columns untouched".
 */
export function preservedOrderFieldsForLineAppend(
  fresh: Order,
): Omit<UpdateOrderDetails, "orderId" | "services" | "materials"> {
  return {
    vehicleId: fresh.vehicleId ?? undefined,
    device: fresh.device,
    carNumber: fresh.carNumber,
    vin: fresh.vin,
    description: fresh.description,
    assignedEmployeeId: fresh.assignedEmployeeId,
    team: (fresh.team ?? []).map((member) => ({ employeeId: member.employeeId, role: member.role })),
    deadline: fresh.deadline,
  };
}

/**
 * Appends new service lines to the order's CURRENT lines (re-read right before saving, so lines another user
 * added meanwhile are not dropped). Existing lines keep their ids / stored fields; the new ones have no id, so
 * `updateOrder` creates them, stamps the client's service discount on them only, syncs warranties and totals.
 * Material lines are omitted → untouched.
 */
export async function appendOrderServiceLines(
  orderId: string,
  drafts: readonly OrderService[],
  workspaceId: string | undefined,
): Promise<Order> {
  // One catalog service (the order-card search): direct insert + totals instead of the full rebuild.
  if (drafts.length === 1 && drafts[0]?.serviceId?.trim()) {
    const quick = await appendOrderCatalogServiceLine(orderId, drafts[0], workspaceId);
    if (quick) return quick;
    // Already on the order → fall through to the full path, which keeps the existing line and changes nothing.
  }
  const fresh = await getOrder(orderId, workspaceId);
  return updateOrder(
    {
      orderId,
      ...preservedOrderFieldsForLineAppend(fresh),
      services: [...fresh.services, ...drafts.map(stripDraftIdentity)],
    },
    workspaceId,
  );
}

/**
 * Same as `appendOrderServiceLines` for materials: `updateOrder` runs the warehouse issue for the new catalog
 * lines (stock errors reject the whole save), stamps the product discount on new lines and recomputes totals.
 * Service lines are omitted → untouched.
 */
export async function appendOrderMaterialLines(
  orderId: string,
  drafts: readonly OrderMaterial[],
  workspaceId: string | undefined,
): Promise<Order> {
  const fresh = await getOrder(orderId, workspaceId);
  return updateOrder(
    {
      orderId,
      ...preservedOrderFieldsForLineAppend(fresh),
      materials: [...(fresh.materials ?? []), ...drafts.map(stripDraftIdentity)],
    },
    workspaceId,
  );
}

/** Drafts must never carry an order-line id: that is what marks a line as "new" for discount stamping / inserts. */
function stripDraftIdentity<T extends { id?: string }>(draft: T): T {
  if (!("id" in draft)) return draft;
  const { id: _id, ...rest } = draft;
  void _id;
  return rest as T;
}
